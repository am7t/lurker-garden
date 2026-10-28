import { speciesTable, type Species } from './species.config.js';

export interface WeightedSpecies {
  id: Species;
  weight: number;
}

// Taking the sample as an argument keeps this deterministic and easy to test.
export function rollSpecies(sample: number, table: readonly WeightedSpecies[] = speciesTable): Species {
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError('Species sample must be in [0, 1).');
  }
  if (!table.length || table.some(({ weight }) => !Number.isFinite(weight) || weight <= 0)) {
    throw new RangeError('Species weights must be finite and positive.');
  }
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  if (!Number.isFinite(total)) throw new RangeError('Species weight total must be finite.');
  const target = sample * total;
  let cumulative = 0;
  for (const entry of table) {
    cumulative += entry.weight;
    if (target < cumulative) return entry.id;
  }
  return table[table.length - 1]!.id;
}

export function speciesName(species: Species): string {
  return speciesTable.find((entry) => entry.id === species)?.name ?? species;
}
