import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Plant } from '../garden/plant.js';
import type { GardenStore } from '../garden/service.js';
import { migrateGarden } from './migrations.js';

type PlantRow = Omit<Plant, 'dormant'> & { dormant: number };
const fromRow = (row: PlantRow): Plant => ({ ...row, dormant: row.dormant === 1 });

export function openGardenStore(filename: string): GardenStore & { close(): void } {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    migrateGarden(db);
  } catch (error) { db.close(); throw error; }
  const find = db.prepare<[string], PlantRow>('SELECT * FROM plants WHERE user_id = ?');
  const list = db.prepare<[], PlantRow>('SELECT * FROM plants ORDER BY planted_at, user_id');
  const save = db.prepare(`
    INSERT INTO plants (user_id, display_name, species, planted_at, last_seen, growth, stage,
      stage_progress, last_watered_at, dormant, woke_at, last_growth_at)
    VALUES (@user_id, @display_name, @species, @planted_at, @last_seen, @growth, @stage,
      @stage_progress, @last_watered_at, @dormant, @woke_at, @last_growth_at)
    ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name,
      last_seen = excluded.last_seen, growth = excluded.growth, stage = excluded.stage,
      stage_progress = excluded.stage_progress, last_watered_at = excluded.last_watered_at,
      dormant = excluded.dormant, woke_at = excluded.woke_at, last_growth_at = excluded.last_growth_at
  `);
  return {
    find(userId) { const row = find.get(userId); return row ? fromRow(row) : undefined; },
    list: () => list.all().map(fromRow),
    save: (plant) => { save.run({ ...plant, dormant: Number(plant.dormant) }); },
    transaction: <T>(work: () => T) => db.transaction(work).immediate(),
    close: () => db.close(),
  };
}
