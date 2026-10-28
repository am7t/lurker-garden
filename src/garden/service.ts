import { plantViewer, type Plant, type PlantingResult, type Viewer } from './plant.js';
import { rollSpecies } from './species.js';
import { growTick, markPresent, plantView, refreshDormancy, stageForGrowth, waterPlant } from './growth.js';
import { createGardenEvents, type GardenEvent } from './events.js';

export interface GardenStore {
  find(userId: string): Plant | undefined;
  save(plant: Plant): void;
  list(): Plant[];
  transaction<T>(work: () => T): T;
}

export function createGarden(
  store: GardenStore,
  random: () => number = Math.random,
  clock: () => string = () => new Date().toISOString(),
) {
  const events = createGardenEvents();
  function change<T>(work: (save: (plant: Plant, previous?: Plant) => void, now: number) => T): T {
    const pending: GardenEvent[] = [];
    const at = clock();
    const result = store.transaction(() => work((plant, previous) => {
      store.save(plant);
      const add = (type: GardenEvent['type']) => pending.push({ type, at, plant: { ...plant } });
      if (!previous) add('planted');
      if (previous && plant.woke_at !== previous.woke_at) add('woke');
      if (previous && plant.last_watered_at !== previous.last_watered_at) add('watered');
      if (previous && stageForGrowth(previous.growth).stage !== plant.stage) add('stage_up');
    }, Date.parse(at)));
    for (const event of pending) events.publish(event);
    return result;
  }

  function maintain(now: number) {
    for (const plant of store.list()) {
      const next = { ...refreshDormancy(plant, now), ...stageForGrowth(plant.growth) };
      if (next.dormant !== plant.dormant || next.stage !== plant.stage || next.stage_progress !== plant.stage_progress) store.save(next);
    }
  }
  function list() {
    const now = Date.parse(clock());
    store.transaction(() => maintain(now));
    return store.list().map((plant) => plantView(plant, now));
  }

  return {
    events,
    list,
    stats() {
      const plants = list();
      const by_stage = { seed: 0, sprout: 0, leafy: 0, budding: 0, bloom: 0 };
      for (const plant of plants) by_stage[plant.stage]++;
      return { total: plants.length, by_stage, dormant: plants.filter((plant) => plant.dormant).length };
    },
    maintain: () => store.transaction(() => maintain(Date.parse(clock()))),
    seen(viewer: Viewer) {
      change((save, now) => {
        const plant = store.find(viewer.userId);
        if (plant) save(markPresent(plant, viewer, now), plant);
      });
    },
    plant(viewer: Viewer): PlantingResult {
      return change((save, now) => {
        const existing = store.find(viewer.userId);
        const species = existing?.species ?? rollSpecies(random());
        const result = plantViewer(existing, viewer, species, new Date(now).toISOString());
        save(result.plant, existing);
        return result;
      });
    },
    tick(viewers: readonly Viewer[], live: boolean, speed = 1) {
      change((save, now) => {
        maintain(now);
        for (const viewer of new Map(viewers.map((viewer) => [viewer.userId, viewer])).values()) {
          const plant = store.find(viewer.userId);
          if (plant) save(growTick(markPresent(plant, viewer, now), now, live, speed), plant);
        }
      });
    },
    water(viewer: Viewer, live: boolean, speed = 1) {
      return change((save, now) => {
        const existing = store.find(viewer.userId);
        if (!existing) return { status: 'missing' as const };
        const result = waterPlant(markPresent(existing, viewer, now), now, live, speed);
        save(result.plant, existing);
        return result;
      });
    },
  };
}

export type Garden = ReturnType<typeof createGarden>;
