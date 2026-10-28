import { describe, expect, it } from 'vitest';
import { isLurkCommand, plantingReply, plantViewer, type Plant } from '../src/garden/plant.js';
import { speciesTable } from '../src/garden/species.config.js';
import { rollSpecies } from '../src/garden/species.js';

const viewer = { userId: '42', displayName: 'CozyViewer' };
const plantedAt = '2026-10-28T12:00:00.000Z';

describe('species rolling', () => {
  it.each([
    [0, 'daisy'], [0.29999, 'daisy'], [0.30, 'tulip'], [0.55, 'fern'],
    [0.80, 'sunflower'], [0.95, 'moonflower'], [0.98, 'glowing-mushroom'],
    [0.995, 'crystal-bloom'], [0.999999, 'crystal-bloom'],
  ] as const)('rolls %s as %s at table boundaries', (sample, species) => {
    expect(rollSpecies(sample)).toBe(species);
  });
  it('honors relative weights even when they do not sum to 100', () => {
    const table = [{ id: 'daisy', weight: 1 }, { id: 'fern', weight: 3 }] as const;
    expect(rollSpecies(0.2499, table)).toBe('daisy');
    expect(rollSpecies(0.25, table)).toBe('fern');
  });
  it('gives the configured frequencies over an evenly spaced sample', () => {
    const counts = new Map<string, number>();
    for (let index = 0; index < 10_000; index++) {
      const species = rollSpecies((index + 0.5) / 10_000);
      counts.set(species, (counts.get(species) ?? 0) + 1);
    }
    for (const entry of speciesTable) expect(counts.get(entry.id)).toBe(entry.weight * 100);
  });
  it.each([-1, 1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid sample %s', (sample) => {
    expect(() => rollSpecies(sample)).toThrow(RangeError);
  });
  it('rejects empty or invalid weight tables', () => {
    expect(() => rollSpecies(0.5, [])).toThrow();
    for (const weight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => rollSpecies(0.5, [{ id: 'daisy', weight }])).toThrow();
    }
  });
});

describe('planting', () => {
  it('starts a new viewer at seed stage, zero growth, and the supplied timestamp', () => {
    expect(plantViewer(undefined, viewer, 'fern', plantedAt)).toEqual({
      planted: true,
      plant: {
        user_id: '42', display_name: 'CozyViewer', species: 'fern',
        growth: 0, stage: 'seed', planted_at: plantedAt, last_seen: plantedAt,
        stage_progress: 0, last_watered_at: null, dormant: false, woke_at: null, last_growth_at: null,
      },
    });
  });
  it('preserves an existing plant while updating its viewer name and last_seen', () => {
    const original: Plant = Object.freeze({
      ...plantViewer(undefined, viewer, 'moonflower', plantedAt).plant,
      stage: 'sprout', growth: 12,
    });
    const result = plantViewer(original, { ...viewer, displayName: 'NewName' }, 'daisy', '2026-10-29T12:00:00.000Z');
    expect(result.planted).toBe(false);
    expect(result.plant).toEqual({ ...original, display_name: 'NewName', last_seen: '2026-10-29T12:00:00.000Z' });
    expect(original.display_name).toBe('CozyViewer');
    expect(plantingReply(result)).toContain('Moonflower');
    expect(plantingReply(result)).toContain('sprout');
  });
  it('does not attach another viewer to an existing plant', () => {
    const existing = plantViewer(undefined, viewer, 'fern', plantedAt).plant;
    expect(() => plantViewer(existing, { userId: '99', displayName: 'Other' }, 'fern', plantedAt)).toThrow();
  });
  it('recognizes the command without matching longer command names', () => {
    for (const text of ['!lurk', ' !LURK ', '!lurk goodnight']) expect(isLurkCommand(text)).toBe(true);
    for (const text of ['hello !lurk', '!lurker', 'lurk', '']) expect(isLurkCommand(text)).toBe(false);
  });
});
