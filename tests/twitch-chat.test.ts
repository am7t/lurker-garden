import { afterEach, expect, it, vi } from 'vitest';
import { createTwitchChat } from '../src/twitch/chat.js';
import type { TwitchAuth } from '../src/twitch/auth.js';
import { createGarden } from '../src/garden/service.js';
import { openGardenStore } from '../src/db/garden-store.js';

const mocks = vi.hoisted(() => ({
  getStream: vi.fn(async () => null as object | null),
  getChatters: vi.fn(async () => ({ data: [{ userId: '42', userDisplayName: 'Quiet' }], cursor: '' })),
  instances: [] as Array<{
    success?: (subscription: { id: string }) => void;
    disconnect?: () => void;
    online?: () => void; offline?: () => void;
    message?: (event: object) => void;
    subscriptions: string[];
  }>,
}));
vi.mock('@twurple/api', () => ({
  ApiClient: class {
    users = { getUserByName: async () => ({ id: '42' }) };
    streams = { getStreamByUserId: mocks.getStream };
    chat = { getChatters: mocks.getChatters, sendChatMessage: async () => ({ isSent: true }) };
  },
}));
vi.mock('@twurple/eventsub-ws', () => ({
  EventSubWsListener: class {
    subscriptions: string[] = [];
    success?: (subscription: { id: string }) => void;
    disconnect?: () => void;
    online?: () => void; offline?: () => void;
    message?: (event: object) => void;
    constructor() { mocks.instances.push(this); }
    onSubscriptionCreateSuccess(callback: NonNullable<typeof this.success>) { this.success = callback; }
    onSubscriptionCreateFailure() {}
    onUserSocketDisconnect(callback: NonNullable<typeof this.disconnect>) { this.disconnect = callback; }
    onRevoke() {}
    onChannelChatMessage(_broadcaster: string, _user: string, callback: NonNullable<typeof this.message>) {
      this.message = callback; this.subscriptions.push('channel.chat.message');
    }
    onStreamOnline(_user: string, callback: NonNullable<typeof this.online>) { this.online = callback; this.subscriptions.push('stream.online'); }
    onStreamOffline(_user: string, callback: NonNullable<typeof this.offline>) { this.offline = callback; this.subscriptions.push('stream.offline'); }
    start() { for (const id of this.subscriptions) this.success?.({ id }); }
    stop() {}
  },
}));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); mocks.instances.length = 0; });

it('registers all stream/chat subscriptions, uses the broadcaster for pagination, and pauses on disconnect', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
  const store = openGardenStore(':memory:');
  const garden = createGarden(store);
  garden.plant({ userId: '42', displayName: 'Quiet' });
  const auth = { userId: '42', provider: {} } as TwitchAuth;
  const chat = createTwitchChat(auth, 'cozy', garden, { info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  try {
    await chat.start();
    await vi.advanceTimersByTimeAsync(0);
    const listener = mocks.instances[0]!;
    expect(listener.subscriptions).toEqual(['channel.chat.message', 'stream.online', 'stream.offline']);
    expect(chat.connected).toBe(true);
    expect(chat.live).toBe(false);
    expect(mocks.getStream).toHaveBeenCalledExactlyOnceWith('42');
    listener.online?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getChatters).toHaveBeenCalledExactlyOnceWith('42', { limit: 1000 });
    expect(store.list()[0]?.growth).toBe(1);
    listener.offline?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getChatters).toHaveBeenCalledOnce();
    listener.disconnect?.();
    expect(chat.live).toBe(false);
    expect(chat.connected).toBe(false);
  } finally { chat.stop(); store.close(); }
});
