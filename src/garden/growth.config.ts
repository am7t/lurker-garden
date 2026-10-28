// Points are watch minutes at GROWTH_SPEED=1: bloom takes seven hours.
export const stageThresholds = [
  { stage: 'seed', points: 0 },
  { stage: 'sprout', points: 30 },
  { stage: 'leafy', points: 120 },
  { stage: 'budding', points: 240 },
  { stage: 'bloom', points: 420 },
] as const;
export type Stage = (typeof stageThresholds)[number]['stage'];
export const growthRules = {
  tickMs: 60_000,
  pointsPerTick: 1,
  waterCooldownMs: 30 * 60_000,
  waterBoost: 5,
  dormantAfterMs: 7 * 24 * 60 * 60_000,
  recentActionMs: 15_000,
} as const;
