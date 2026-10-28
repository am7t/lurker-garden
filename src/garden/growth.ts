import type { Plant, Viewer } from './plant.js';
import { growthRules, stageThresholds } from './growth.config.js';

export function stageForGrowth(growth: number) {
  if (!Number.isFinite(growth) || growth < 0) throw new RangeError('Growth must be finite and nonnegative.');
  let index = 0;
  for (let i = 1; i < stageThresholds.length; i++) {
    if (growth >= stageThresholds[i]!.points) index = i;
  }
  const current = stageThresholds[index]!;
  const next = stageThresholds[index + 1];
  return {
    stage: current.stage,
    stage_progress: next ? Math.min(1, (growth - current.points) / (next.points - current.points)) : 1,
  };
}

export function refreshDormancy(plant: Plant, now: number): Plant {
  const dormant = plant.dormant || now - Date.parse(plant.last_seen) >= growthRules.dormantAfterMs;
  return { ...plant, dormant };
}

export function markPresent(plant: Plant, viewer: Viewer, now: number): Plant {
  const wasDormant = refreshDormancy(plant, now).dormant;
  return {
    ...plant, display_name: viewer.displayName,
    last_seen: new Date(Math.max(now, Date.parse(plant.last_seen))).toISOString(),
    dormant: false, woke_at: wasDormant ? new Date(now).toISOString() : plant.woke_at,
  };
}

function addGrowth(plant: Plant, points: number): Plant {
  if (!Number.isFinite(points) || points < 0) throw new RangeError('Growth boost must be finite and nonnegative.');
  const growth = plant.growth + points;
  return { ...plant, growth, ...stageForGrowth(growth) };
}

export function growTick(plant: Plant, now: number, live: boolean, speed = 1): Plant {
  if (!live || plant.dormant) return plant;
  const previous = Date.parse(plant.last_growth_at ?? plant.planted_at);
  if (now - previous < growthRules.tickMs) return plant;
  return { ...addGrowth(plant, growthRules.pointsPerTick * speed), last_growth_at: new Date(now).toISOString() };
}

export type WaterResult =
  | { status: 'watered'; plant: Plant }
  | { status: 'cooldown'; plant: Plant; waitMs: number }
  | { status: 'offline'; plant: Plant };

export function waterPlant(plant: Plant, now: number, live: boolean, speed = 1): WaterResult {
  if (!live) return { status: 'offline', plant };
  const waitMs = plant.last_watered_at === null ? 0
    : growthRules.waterCooldownMs - (now - Date.parse(plant.last_watered_at));
  if (waitMs > 0) return { status: 'cooldown', plant, waitMs };
  return {
    status: 'watered',
    plant: { ...addGrowth(plant, growthRules.waterBoost * speed), last_watered_at: new Date(now).toISOString() },
  };
}

export function plantView(plant: Plant, now: number) {
  const recent = (at: string | null) => at !== null && now >= Date.parse(at)
    && now - Date.parse(at) < growthRules.recentActionMs;
  return {
    ...refreshDormancy(plant, now), ...stageForGrowth(plant.growth),
    recently_woke: recent(plant.woke_at), recently_watered: recent(plant.last_watered_at),
  };
}
