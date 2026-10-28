import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openGardenStore } from '../src/db/garden-store.js';
import { createGarden } from '../src/garden/service.js';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('SQLite garden', () => {
  it('survives a restart and never rerolls a duplicate viewer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lurker-garden-test-'));
    directories.push(dir);
    const filename = join(dir, 'garden.sqlite');
    const viewer = { userId: '1', displayName: 'FirstName' };
    const firstStore = openGardenStore(filename);
    const firstGarden = createGarden(firstStore, () => 0.999, () => '2026-10-28T12:00:00.000Z');
    const first = firstGarden.plant(viewer);
    firstStore.close();
    const secondStore = openGardenStore(filename);
    try {
      const random = vi.fn(() => 0);
      const secondGarden = createGarden(secondStore, random, () => '2026-10-29T12:00:00.000Z');
      const duplicate = secondGarden.plant({ ...viewer, displayName: 'Renamed' });
      expect(duplicate.planted).toBe(false);
      expect(duplicate.plant.species).toBe('crystal-bloom');
      expect(duplicate.plant.planted_at).toBe(first.plant.planted_at);
      expect(duplicate.plant.last_seen).toBe('2026-10-29T12:00:00.000Z');
      expect(random).not.toHaveBeenCalled();
      expect(secondGarden.list()).toEqual([expect.objectContaining(duplicate.plant)]);
      // The key is the Twitch ID, even if two viewers have the same name.
      secondGarden.plant({ userId: '2', displayName: 'Renamed' });
      expect(secondGarden.list()).toHaveLength(2);
    } finally { secondStore.close(); }
  });
  it('touches only existing viewers on normal chat messages', () => {
    const store = openGardenStore(':memory:');
    let at = '2026-10-28T12:00:00.000Z';
    try {
      const garden = createGarden(store, () => 0, () => at);
      garden.seen({ userId: 'unknown', displayName: 'Unknown' });
      expect(garden.list()).toEqual([]);
      garden.plant({ userId: '1', displayName: 'Old' });
      at = '2026-10-28T13:00:00.000Z';
      garden.seen({ userId: '1', displayName: 'New' });
      expect(garden.list()[0]).toMatchObject({ display_name: 'New', last_seen: at, growth: 0, stage: 'seed' });
    } finally { store.close(); }
  });
});

it('persists watered and dormant state through a real database reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'garden-growth-test-'));
  directories.push(dir);
  const filename = join(dir, 'garden.sqlite');
  const t = Date.parse('2026-10-28T12:00:00Z');
  const viewer = { userId: '1', displayName: 'Cozy' };
  let store = openGardenStore(filename);
  const first = createGarden(store, () => 0, () => new Date(t).toISOString());
  first.plant(viewer);
  first.water(viewer, true, 6);
  store.close();
  store = openGardenStore(filename);
  try {
    const afterRestart = createGarden(store, () => 0, () => new Date(t + 60_000).toISOString());
    expect(afterRestart.water(viewer, true)).toMatchObject({ status: 'cooldown', waitMs: 29 * 60_000 });
    expect(afterRestart.list()[0]).toMatchObject({ stage: 'sprout', growth: 30 });
    const later = createGarden(store, () => 0, () => new Date(t + 8 * 24 * 60 * 60_000).toISOString());
    later.maintain();
    expect(store.list()[0]?.dormant).toBe(true);
    later.seen(viewer);
    expect(store.list()[0]).toMatchObject({ dormant: false, growth: 30, woke_at: new Date(t + 8 * 24 * 60 * 60_000).toISOString() });
  } finally { store.close(); }
});
