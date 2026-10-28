import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import type { Garden } from '../garden/service.js';
import type { TwitchAuth } from './auth.js';
import { createChatHandler } from './chat-handler.js';

interface Log {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createTwitchChat(auth: TwitchAuth, channel: string, garden: Garden, log: Log) {
  const api = new ApiClient({ authProvider: auth.provider, logger: { minLevel: 'critical' } });
  let listener: EventSubWsListener | undefined;
  let connected = false;
  let generation = 0;

  function stop() {
    generation++;
    connected = false;
    const previous = listener;
    listener = undefined;
    previous?.stop();
  }

  return {
    get connected() { return connected; },
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
      const handle = createChatHandler(garden, async (text, messageId) => {
        // The broadcaster user token sends replies through Helix, never IRC.
        const sent = await api.chat.sendChatMessage(broadcaster.id, text, { replyParentMessageId: messageId });
        if (!sent.isSent) log.warn('Twitch dropped a garden reply. Check channel chat restrictions.');
      });
      next.onSubscriptionCreateSuccess(() => {
        if (listener !== next) return;
        connected = true;
        log.info(`Listening for !lurk in ${channel} via EventSub WebSockets.`);
      });
      next.onSubscriptionCreateFailure(() => {
        if (listener !== next) return;
        connected = false;
        log.error('Twitch chat subscription failed. Check authorization and reconnect at /auth/login.');
      });
      next.onUserSocketDisconnect(() => {
        if (listener !== next) return;
        connected = false;
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
      next.start();
    },
  };
}

export type TwitchChat = ReturnType<typeof createTwitchChat>;
