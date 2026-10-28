import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createTokenStore, type SavedToken } from '../src/twitch/token-store.js';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const saved: SavedToken = {
  clientId: 'fake-client', userId: '42',
  token: { accessToken: 'fake-access', refreshToken: 'fake-refresh', scope: ['user:read:chat'], expiresIn: 3600, obtainmentTimestamp: 1 },
};

it('saves tokens privately, reloads after restart, and replaces refreshed tokens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'garden-token-test-'));
  directories.push(dir);
  const filename = join(dir, 'data/tokens.json');
  const store = createTokenStore(filename);
  expect(store.load()).toBeUndefined();
  store.save(saved);
  expect(createTokenStore(filename).load()).toEqual(saved);
  if (process.platform !== 'win32') expect(statSync(filename).mode & 0o777).toBe(0o600);
  store.save({ ...saved, token: { ...saved.token, refreshToken: 'fake-rotated' } });
  expect(store.load()?.token.refreshToken).toBe('fake-rotated');
  expect(readFileSync(filename, 'utf8')).not.toContain('fake-refresh');
});

it('reports corrupt token storage without exposing the file contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'garden-token-test-'));
  directories.push(dir);
  const filename = join(dir, 'tokens.json');
  writeFileSync(filename, '{fake-sensitive-data');
  expect(() => createTokenStore(filename).load()).toThrow('Could not load local OAuth tokens. Reconnect at /auth/login.');
});
