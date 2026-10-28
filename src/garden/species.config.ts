// Relative weights: common plants total 95%, rare plants total 5%.
export const speciesTable = [
  { id: 'daisy', name: 'Daisy', weight: 30 },
  { id: 'tulip', name: 'Tulip', weight: 25 },
  { id: 'fern', name: 'Fern', weight: 25 },
  { id: 'sunflower', name: 'Sunflower', weight: 15 },
  { id: 'moonflower', name: 'Moonflower', weight: 3 },
  { id: 'glowing-mushroom', name: 'Glowing Mushroom', weight: 1.5 },
  { id: 'crystal-bloom', name: 'Crystal Bloom', weight: 0.5 },
] as const;

export type Species = (typeof speciesTable)[number]['id'];
