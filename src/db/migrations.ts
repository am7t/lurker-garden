import type Database from 'better-sqlite3';
import { stageForGrowth } from '../garden/growth.js';

const createPlants = `CREATE TABLE plants (
  user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, species TEXT NOT NULL,
  planted_at TEXT NOT NULL, last_seen TEXT NOT NULL,
  growth REAL NOT NULL DEFAULT 0 CHECK (growth >= 0),
  stage TEXT NOT NULL DEFAULT 'seed' CHECK (stage IN ('seed', 'sprout', 'leafy', 'budding', 'bloom')),
  stage_progress REAL NOT NULL DEFAULT 0 CHECK (stage_progress BETWEEN 0 AND 1),
  last_watered_at TEXT, dormant INTEGER NOT NULL DEFAULT 0 CHECK (dormant IN (0, 1)),
  woke_at TEXT, last_growth_at TEXT
) STRICT;`;

// v0 is the original unversioned foundation. Rebuild transactionally to replace
// SQLite's old stage CHECK constraint while preserving every plant and timestamp.
export function migrateGarden(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > 1) throw new Error('Garden database was created by a newer app.');
  if (version === 1) return;
  db.transaction(() => {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plants'").get();
    if (!exists) db.exec(createPlants);
    else {
      db.exec('ALTER TABLE plants RENAME TO plants_legacy');
      db.exec(createPlants);
      const rows = db.prepare<[], {
        user_id: string; display_name: string; species: string;
        planted_at: string; last_seen: string; growth: number;
      }>('SELECT user_id, display_name, species, planted_at, last_seen, growth FROM plants_legacy').all();
      const insert = db.prepare(`INSERT INTO plants
        (user_id, display_name, species, planted_at, last_seen, growth, stage, stage_progress)
        VALUES (@user_id, @display_name, @species, @planted_at, @last_seen, @growth, @stage, @stage_progress)`);
      for (const row of rows) insert.run({ ...row, ...stageForGrowth(row.growth) });
      db.exec('DROP TABLE plants_legacy');
    }
    db.pragma('user_version = 1');
  }).immediate();
}
