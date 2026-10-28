import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { collectChatters, createPresence, type ChatterPage } from '../src/twitch/presence.js';

const viewer = { userId: '42', displayName: 'QuietLurker' };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T12:00:00Z')); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

function fixture(live = true, forceLive = false) {
  const garden = { tick: vi.fn(), maintain: vi.fn() };
  const getLive = vi.fn(async () => live);
  const getPage = vi.fn(async (_after?: string): Promise<ChatterPage> => ({ viewers: [viewer] }));
  const warn = vi.fn();
  const presence = createPresence({ garden, getLive, getPage, warn, forceLive, speed: 10 });
  return { presence, garden, getLive, getPage, warn };
}

it('checks live status at startup, polls each minute, and stops growing offline', async () => {
  const { presence, garden, getLive, getPage } = fixture();
  await presence.start();
  expect(getLive).toHaveBeenCalledOnce();
  expect(presence.live).toBe(true);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(getPage).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(garden.tick).toHaveBeenCalledExactlyOnceWith([viewer], true, 10);
  presence.setLive(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(getPage).toHaveBeenCalledOnce();
  expect(garden.maintain).toHaveBeenCalledTimes(2);
  presence.setLive(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(getPage).toHaveBeenCalledTimes(2);
  presence.stop();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(getPage).toHaveBeenCalledTimes(2);
  expect(presence.live).toBe(false);
});

it('supports forced live without increasing polling frequency', async () => {
  const { presence, getPage } = fixture(false, true);
  await presence.start();
  expect(presence.actualLive).toBe(false);
  expect(presence.live).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(getPage).toHaveBeenCalledOnce();
  presence.setLive(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(getPage).toHaveBeenCalledTimes(2);
});

it('lets newer stream events override an in-flight startup status query', async () => {
  let resolve!: (value: boolean) => void;
  const { presence, getLive } = fixture();
  getLive.mockImplementationOnce(() => new Promise<boolean>((done) => { resolve = done; }));
  const starting = presence.start();
  presence.setLive(false);
  resolve(true);
  await starting;
  expect(presence.live).toBe(false);
});

it('discards partial chatter results if the stream ends or authorization stops', async () => {
  let resolve!: (page: ChatterPage) => void;
  const { presence, garden, getPage } = fixture();
  getPage.mockImplementationOnce(() => new Promise<ChatterPage>((done) => { resolve = done; }));
  await presence.start();
  await vi.advanceTimersByTimeAsync(60_000);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(getPage).toHaveBeenCalledOnce(); // No overlapping request or catch-up tick.
  presence.setLive(false);
  resolve({ viewers: [viewer], cursor: 'next' });
  await vi.advanceTimersByTimeAsync(0);
  expect(garden.tick).not.toHaveBeenCalled();
  presence.stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(getPage).toHaveBeenCalledOnce();
});

it('skips failed polls, retries on the next minute, and maintains dormancy', async () => {
  const { presence, garden, getPage, warn } = fixture();
  getPage.mockRejectedValueOnce(new Error('fake rate limit'));
  await presence.start();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(garden.tick).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(59_999);
  expect(getPage).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(garden.tick).toHaveBeenCalledOnce();
});

it('stays offline safely when the startup status check fails', async () => {
  const { presence, getLive, getPage } = fixture();
  getLive.mockRejectedValueOnce(new Error('fake network failure'));
  await presence.start();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(presence.live).toBe(false);
  expect(getPage).not.toHaveBeenCalled();
});

it('fetches every page and deduplicates viewers who appear on multiple pages', async () => {
  const page = vi.fn(async (after?: string): Promise<ChatterPage> => after
    ? { viewers: [viewer, { userId: '43', displayName: 'AnotherLurker' }] }
    : { viewers: [viewer], cursor: 'next' });
  expect(await collectChatters(page)).toEqual([viewer, { userId: '43', displayName: 'AnotherLurker' }]);
  expect(page.mock.calls).toEqual([[undefined], ['next']]);
});

it('rejects repeated cursors and never exposes a failed partial scan as a tick', async () => {
  const page = vi.fn(async () => ({ viewers: [viewer], cursor: 'same' }));
  await expect(collectChatters(page)).rejects.toThrow('repeated');
  expect(page).toHaveBeenCalledTimes(2);
});
