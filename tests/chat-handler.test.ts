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
