import { plantViewer, type Plant, type PlantingResult, type Viewer } from './plant.js';
import { rollSpecies } from './species.js';

export interface GardenStore {
  find(userId: string): Plant | undefined;
  save(plant: Plant): void;
  touch(viewer: Viewer, at: string): void;
  list(): Plant[];
  transaction<T>(work: () => T): T;
}

export function createGarden(
  store: GardenStore,
  random: () => number = Math.random,
  clock: () => string = () => new Date().toISOString(),
) {
  return {
    list: () => store.list(),
    seen: (viewer: Viewer) => store.touch(viewer, clock()),
    plant(viewer: Viewer): PlantingResult {
      return store.transaction(() => {
        const existing = store.find(viewer.userId);
        const species = existing?.species ?? rollSpecies(random());
        const result = plantViewer(existing, viewer, species, clock());
        store.save(result.plant);
        return result;
      });
    },
  };
}

export type Garden = ReturnType<typeof createGarden>;
