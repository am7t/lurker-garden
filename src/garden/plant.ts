import type { Species } from './species.config.js';
import { speciesName } from './species.js';
import type { Stage } from './growth.config.js';
import { markPresent } from './growth.js';

export interface Viewer {
  userId: string;
  displayName: string;
}

export interface Plant {
  user_id: string;
  display_name: string;
  species: Species;
  planted_at: string;
  last_seen: string;
  growth: number;
  stage: Stage;
  stage_progress: number;
  last_watered_at: string | null;
  dormant: boolean;
  woke_at: string | null;
  last_growth_at: string | null;
}

export interface PlantingResult {
  planted: boolean;
  plant: Plant;
}

export function plantViewer(
  existing: Plant | undefined,
  viewer: Viewer,
  species: Species,
  at: string,
): PlantingResult {
  if (existing) {
    if (existing.user_id !== viewer.userId) throw new Error('Plant belongs to another viewer.');
    return {
      planted: false,
      plant: markPresent(existing, viewer, Date.parse(at)),
    };
  }
  return {
    planted: true,
    plant: {
      user_id: viewer.userId,
      display_name: viewer.displayName,
      species,
      planted_at: at,
      last_seen: at,
      growth: 0,
      stage: 'seed',
      stage_progress: 0,
      last_watered_at: null,
      dormant: false,
      woke_at: null,
      last_growth_at: null,
    },
  };
}

export function plantingReply({ plant, planted }: PlantingResult): string {
  const name = speciesName(plant.species);
  return planted
    ? `@${plant.display_name}, a little ${name} seed is yours. Settle in and enjoy the garden!`
    : `@${plant.display_name}, your ${name} is cozy here at the ${plant.stage} stage. Happy lurking!`;
}

export function isLurkCommand(text: string): boolean {
  return /^!lurk(?:\s|$)/i.test(text.trim());
}
