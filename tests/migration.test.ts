import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { migrateGarden } from '../src/db/migrations.js';

it('migrates the exact foundation schema without losing plants and is idempotent', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE plants (
      user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, species TEXT NOT NULL,
      planted_at TEXT NOT NULL, last_seen TEXT NOT NULL,
      growth REAL NOT NULL DEFAULT 0 CHECK (growth >= 0),
      stage TEXT NOT NULL DEFAULT 'seed' CHECK (stage IN ('seed', 'sprout', 'growing', 'bloom'))
    ) STRICT;
    INSERT INTO plants VALUES ('42', 'Cozy', 'fern', '2026-10-20T00:00:00.000Z', '2026-10-21T00:00:00.000Z', 180, 'growing');
    INSERT INTO plants VALUES ('43', 'Seed', 'daisy', '2026-10-20T00:00:00.000Z', '2026-10-21T00:00:00.000Z', 0, 'seed');`);
    migrateGarden(db);
    const rows = db.prepare('SELECT * FROM plants ORDER BY user_id').all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      user_id: '42', display_name: 'Cozy', species: 'fern',
      planted_at: '2026-10-20T00:00:00.000Z', last_seen: '2026-10-21T00:00:00.000Z',
      growth: 180, stage: 'leafy', stage_progress: 0.5, last_watered_at: null,
      dormant: 0, woke_at: null, last_growth_at: null,
    });
    db.prepare("UPDATE plants SET stage = 'budding' WHERE user_id = '42'").run();
    migrateGarden(db);
    expect(db.prepare("SELECT stage FROM plants WHERE user_id = '42'").get()).toEqual({ stage: 'budding' });
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  } finally { db.close(); }
});

it('rolls back a failed migration and rejects future schema versions', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE plants (user_id TEXT)');
    expect(() => migrateGarden(db)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'plants'").get()).toBeTruthy();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'plants_legacy'").get()).toBeUndefined();
    expect(db.pragma('user_version', { simple: true })).toBe(0);
    db.pragma('user_version = 99');
    expect(() => migrateGarden(db)).toThrow('newer app');
  } finally { db.close(); }
});
