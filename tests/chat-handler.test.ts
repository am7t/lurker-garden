import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openGardenStore } from '../src/db/garden-store.js';
import { createGarden } from '../src/garden/service.js';
import { createChatHandler } from '../src/twitch/chat-handler.js';

let store: ReturnType<typeof openGardenStore>;
beforeEach(() => { store = openGardenStore(':memory:'); });
afterEach(() => store.close());
const message = { id: 'message-1', userId: '42', displayName: 'Cozy', text: '!lurk' };

it('plants, replies, and ignores an EventSub redelivery', async () => {
  const reply = vi.fn(async () => {});
  const handle = createChatHandler(createGarden(store, () => 0), reply);
  await handle(message);
  await handle(message);
  expect(store.list()).toHaveLength(1);
  expect(reply).toHaveBeenCalledTimes(1);
  expect(reply).toHaveBeenLastCalledWith(expect.stringContaining('Daisy seed'), 'message-1');
  await handle({ ...message, id: 'message-2' });
  expect(reply).toHaveBeenCalledTimes(2);
  expect(reply).toHaveBeenLastCalledWith(expect.stringContaining('seed stage'), 'message-2');
  expect(store.list()).toHaveLength(1);
});

it('keeps the plant if Twitch rejects a reply', async () => {
  const handle = createChatHandler(createGarden(store), async () => { throw new Error('Chat unavailable'); });
  await expect(handle(message)).rejects.toThrow('Chat unavailable');
  expect(store.list()).toHaveLength(1);
});

it('updates the name on ordinary messages without creating extra plants or replying', async () => {
  const reply = vi.fn(async () => {});
  const handle = createChatHandler(createGarden(store), reply);
  await handle(message);
  await handle({ ...message, id: 'message-2', displayName: 'NewName', text: 'hello' });
  await handle({ ...message, id: 'message-3', userId: '43', text: '!lurker' });
  expect(store.list()).toHaveLength(1);
  expect(store.list()[0]?.display_name).toBe('NewName');
  expect(reply).toHaveBeenCalledTimes(1);
});

it('waters once, replies with the wait time, and persists the cooldown after reopening a handler', async () => {
  let now = Date.parse('2026-10-28T12:00:00Z');
  const garden = createGarden(store, () => 0, () => new Date(now).toISOString());
  garden.plant({ userId: '42', displayName: 'Cozy' });
  const reply = vi.fn(async () => {});
  const handler = createChatHandler(garden, reply, () => true);
  await handler({ ...message, id: 'water-1', text: '!water' });
  expect(store.list()[0]?.growth).toBe(5);
  await createChatHandler(garden, reply, () => true)({ ...message, id: 'water-2', text: '!WATER' });
  expect(store.list()[0]?.growth).toBe(5);
  expect(reply).toHaveBeenLastCalledWith(expect.stringContaining('30 minute'), 'water-2');
  now += 30 * 60_000 - 1000;
  await handler({ ...message, id: 'water-3', text: '!water' });
  expect(reply).toHaveBeenLastCalledWith(expect.stringContaining('1 second'), 'water-3');
});

it('explains missing plants and offline watering without consuming a cooldown', async () => {
  const garden = createGarden(store);
  const reply = vi.fn(async () => {});
  const handler = createChatHandler(garden, reply);
  await handler({ ...message, text: '!water' });
  expect(reply).toHaveBeenLastCalledWith(expect.stringContaining('!lurk first'), 'message-1');
  garden.plant({ userId: '42', displayName: 'Cozy' });
  await handler({ ...message, id: 'water-2', text: '!water' });
  expect(reply).toHaveBeenLastCalledWith(expect.stringContaining('resting'), 'water-2');
  expect(store.list()[0]?.last_watered_at).toBeNull();
});
