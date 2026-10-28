import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import type { Garden } from '../garden/service.js';
import type { TwitchAuth } from './auth.js';
import { createPresence } from './presence.js';
import { createChatHandler } from './chat-handler.js';

interface Log {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createTwitchChat(
  auth: TwitchAuth, channel: string, garden: Garden, log: Log,
  options = { forceLive: false, speed: 1 },
) {
  const api = new ApiClient({ authProvider: auth.provider, logger: { minLevel: 'critical' } });
  let listener: EventSubWsListener | undefined;
  let connected = false;
  let generation = 0;
  const presence = createPresence({
    garden, forceLive: options.forceLive, speed: options.speed,
    warn: (message) => log.warn(message),
    getLive: async () => Boolean(await api.streams.getStreamByUserId(auth.userId!)),
    getPage: async (after) => {
      const result = await api.chat.getChatters(auth.userId!, { limit: 1000, ...(after ? { after } : {}) });
      return { viewers: result.data.map((chatter) => ({ userId: chatter.userId, displayName: chatter.userDisplayName })),
        ...(result.cursor ? { cursor: result.cursor } : {}) };
    },
  });

  function stop() {
    generation++;
    presence.stop();
    connected = false;
    const previous = listener;
    listener = undefined;
    previous?.stop();
  }

  return {
    get connected() { return connected; },
    get live() { return presence.live; },
    get actualLive() { return presence.actualLive; },
    stop,
    async start() {
      stop();
      const startingGeneration = generation;
      const userId = auth.userId;
      if (!userId) return;
      const broadcaster = await api.users.getUserByName(channel);
      if (startingGeneration !== generation || auth.userId !== userId) return;
      if (!broadcaster || broadcaster.id !== userId) {
        throw new Error('Authorize the configured broadcaster account at /auth/login.');
      }
      const next = new EventSubWsListener({ apiClient: api, logger: { minLevel: 'critical' } });
      listener = next;
      const activeSubscriptions = new Set<string>();
      let tracking = false;
      const handle = createChatHandler(garden, async (text, messageId) => {
        // The broadcaster user token sends replies through Helix, never IRC.
        const sent = await api.chat.sendChatMessage(broadcaster.id, text, { replyParentMessageId: messageId });
        if (!sent.isSent) log.warn('Twitch dropped a garden reply. Check channel chat restrictions.');
      }, () => presence.live, options.speed);
      next.onSubscriptionCreateSuccess((subscription) => {
        if (listener !== next) return;
        activeSubscriptions.add(subscription.id);
        if (activeSubscriptions.size === 3 && !tracking) {
          tracking = true;
          connected = true;
          void presence.start();
          log.info(`Listening for !lurk, !water, and stream presence in ${channel}.`);
        }
      });
      next.onSubscriptionCreateFailure((subscription) => {
        if (listener !== next) return;
        connected = false;
        activeSubscriptions.delete(subscription.id);
        tracking = false;
        presence.stop();
        log.error('Twitch chat subscription failed. Check authorization and reconnect at /auth/login.');
      });
      next.onUserSocketDisconnect(() => {
        if (listener !== next) return;
        connected = false;
        activeSubscriptions.clear();
        tracking = false;
        presence.stop();
        log.warn('Twitch chat disconnected; Twurple will attempt to reconnect.');
      });
      next.onRevoke(() => {
        if (listener !== next) return;
        log.warn('Twitch revoked the chat subscription. Reconnect at /auth/login.');
        auth.invalidate();
      });
      next.onChannelChatMessage(broadcaster.id, userId, (event) => {
        if (listener !== next || auth.userId !== userId) return;
        // Ignore messages originating in another channel during Shared Chat.
        if (event.sourceBroadcasterId && event.sourceBroadcasterId !== broadcaster.id) return;
        void handle({
          id: event.messageId,
          userId: event.chatterId,
          displayName: event.chatterDisplayName,
          text: event.messageText,
        }).catch(() => log.error('Could not process a garden message or send its reply.'));
      });
      next.onStreamOnline(broadcaster.id, () => {
        if (listener === next) presence.setLive(true);
      });
      next.onStreamOffline(broadcaster.id, () => {
        if (listener === next) presence.setLive(false);
      });
      next.start();
    },
  };
}

export type TwitchChat = ReturnType<typeof createTwitchChat>;
