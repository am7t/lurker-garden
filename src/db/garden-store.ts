import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Plant, Viewer } from '../garden/plant.js';
import type { GardenStore } from '../garden/service.js';

export function openGardenStore(filename: string): GardenStore & { close(): void } {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS plants (
      user_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      species TEXT NOT NULL,
      planted_at TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      growth REAL NOT NULL DEFAULT 0 CHECK (growth >= 0),
      stage TEXT NOT NULL DEFAULT 'seed' CHECK (stage IN ('seed', 'sprout', 'growing', 'bloom'))
    ) STRICT;
  `);
  const find = db.prepare<[string], Plant>('SELECT * FROM plants WHERE user_id = ?');
  const list = db.prepare<[], Plant>('SELECT * FROM plants ORDER BY planted_at, user_id');
  const save = db.prepare(`
    INSERT INTO plants (user_id, display_name, species, planted_at, last_seen, growth, stage)
    VALUES (@user_id, @display_name, @species, @planted_at, @last_seen, @growth, @stage)
    ON CONFLICT(user_id) DO UPDATE SET
      display_name = excluded.display_name,
      last_seen = excluded.last_seen
  `);
  const touch = db.prepare('UPDATE plants SET display_name = ?, last_seen = ? WHERE user_id = ?');
  return {
    find: (userId) => find.get(userId),
    list: () => list.all(),
    save: (plant) => { save.run(plant); },
    touch: (viewer: Viewer, at) => { touch.run(viewer.displayName, at, viewer.userId); },
    transaction: <T>(work: () => T) => db.transaction(work).immediate(),
    close: () => db.close(),
  };
}
