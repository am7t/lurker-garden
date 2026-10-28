import { describe, expect, it } from 'vitest';
import { growTick, markPresent, plantView, refreshDormancy, stageForGrowth, waterPlant } from '../src/garden/growth.js';
import { growthRules, stageThresholds } from '../src/garden/growth.config.js';
import { plantViewer } from '../src/garden/plant.js';
import { openGardenStore } from '../src/db/garden-store.js';
import { createGarden } from '../src/garden/service.js';

const t = Date.parse('2026-10-28T12:00:00.000Z');
const viewer = { userId: '42', displayName: 'Cozy' };
const seed = () => plantViewer(undefined, viewer, 'fern', new Date(t).toISOString()).plant;

describe('stages and ticks', () => {
  it.each(stageThresholds)('enters $stage at $points points with the correct progress', ({ stage, points }) => {
    expect(stageForGrowth(points)).toEqual({ stage, stage_progress: stage === 'bloom' ? 1 : 0 });
  });
  it('computes progress between thresholds and saturates progress at bloom', () => {
    expect(stageForGrowth(15)).toEqual({ stage: 'seed', stage_progress: 0.5 });
    expect(stageForGrowth(75)).toEqual({ stage: 'sprout', stage_progress: 0.5 });
    expect(stageForGrowth(999)).toEqual({ stage: 'bloom', stage_progress: 1 });
    expect(stageForGrowth(419).stage).toBe('budding');
    expect(() => stageForGrowth(-1)).toThrow();
  });
  it('awards one point per live minute and reaches bloom in seven hours', () => {
    let plant = seed();
    for (let minute = 1; minute <= 420; minute++) {
      const now = t + minute * 60_000;
      plant = growTick(markPresent(plant, viewer, now), now, true);
    }
    expect(plant.growth).toBe(420);
    expect(plant.stage).toBe('bloom');
  });
  it('does not award offline, dormant, early, or duplicate ticks', () => {
    const plant = seed();
    expect(growTick(plant, t + 60_000, false)).toEqual(plant);
    expect(growTick({ ...plant, dormant: true }, t + 60_000, true).growth).toBe(0);
    expect(growTick(plant, t + 59_999, true).growth).toBe(0);
    const ticked = growTick(plant, t + 60_000, true, 10);
    expect(ticked.growth).toBe(10);
    expect(growTick(ticked, t + 60_000, true).growth).toBe(10);
    expect(growTick(ticked, t + 10 * 60 * 60_000, true).growth).toBe(11);
  });
});

describe('water', () => {
  it('boosts growth and keeps the cooldown on a real clock, independent of speed', () => {
    const result = waterPlant(seed(), t, true, 6);
    expect(result.status).toBe('watered');
    expect(result.plant.growth).toBe(30);
    expect(result.plant.stage).toBe('sprout');
    expect(waterPlant(result.plant, t + 1, true, 100)).toMatchObject({ status: 'cooldown', waitMs: growthRules.waterCooldownMs - 1 });
    expect(waterPlant(result.plant, t + growthRules.waterCooldownMs, true).status).toBe('watered');
  });
  it('does not consume the cooldown or grow offline', () => {
    expect(waterPlant(seed(), t, false)).toEqual({ status: 'offline', plant: seed() });
  });
});

describe('dormancy and wake flags', () => {
  it('goes dormant at seven days, never removing growth, and wakes on presence', () => {
    const plant = { ...seed(), growth: 120, ...stageForGrowth(120) };
    expect(refreshDormancy(plant, t + growthRules.dormantAfterMs - 1).dormant).toBe(false);
    const asleep = refreshDormancy(plant, t + growthRules.dormantAfterMs);
    expect(asleep).toMatchObject({ dormant: true, growth: 120, stage: 'leafy' });
    const now = t + growthRules.dormantAfterMs;
    // Also wakes correctly before a maintenance sweep has marked the plant dormant.
    const awake = markPresent(plant, { ...viewer, displayName: 'NewName' }, now);
    expect(awake).toMatchObject({ dormant: false, growth: 120, display_name: 'NewName', woke_at: new Date(now).toISOString() });
    expect(plantView(awake, now).recently_woke).toBe(true);
    expect(plantView(awake, now + growthRules.recentActionMs).recently_woke).toBe(false);
    expect(markPresent(awake, viewer, now + 1000).woke_at).toBe(awake.woke_at);
  });
  it('expires recent-water flags without erasing the action timestamp', () => {
    const { plant } = waterPlant(seed(), t, true);
    expect(plantView(plant, t).recently_watered).toBe(true);
    expect(plantView(plant, t + growthRules.recentActionMs).recently_watered).toBe(false);
    expect(plantView(plant, t - 1).recently_watered).toBe(false);
    expect(plant.last_watered_at).toBe(new Date(t).toISOString());
  });
});

it('persists cooldowns, wakes silent chatters once, emits committed events, and returns stats', () => {
  const store = openGardenStore(':memory:');
  let now = t;
  const garden = createGarden(store, () => 0, () => new Date(now).toISOString());
  const events: string[] = [];
  const unsubscribe = garden.events.subscribe((event) => {
    expect(store.find(event.plant.user_id)?.growth).toBe(event.plant.growth);
    events.push(event.type);
  });
  try {
    garden.plant(viewer);
    garden.water(viewer, true, 6);
    expect(garden.water(viewer, true).status).toBe('cooldown');
    expect(events).toEqual(['planted', 'watered', 'stage_up']);
    now += growthRules.dormantAfterMs;
    expect(garden.stats()).toMatchObject({ total: 1, dormant: 1, by_stage: { sprout: 1 } });
    garden.tick([viewer, viewer, { userId: 'missing', displayName: 'NoPlant' }], true);
    expect(garden.list()[0]).toMatchObject({ dormant: false, growth: 31, recently_woke: true });
    expect(events.filter((event) => event === 'woke')).toHaveLength(1);
    expect(garden.list()).toHaveLength(1);
    expect(garden.water({ userId: 'missing', displayName: 'NoPlant' }, true).status).toBe('missing');
  } finally { unsubscribe(); store.close(); }
});
