import { expect, it } from 'vitest';
import { readConfig } from '../src/config.js';

const env = { TWITCH_CLIENT_ID: 'fake-id', TWITCH_CLIENT_SECRET: 'fake-secret', TWITCH_CHANNEL: 'Cozy', PORT: '3000' };
it('normalizes channel names and derives the exact localhost callback', () => {
  expect(readConfig(env)).toMatchObject({ channel: 'cozy', port: 3000, redirectUri: 'http://localhost:3000/auth/callback' });
});
it('reports missing config keys without exposing their values', () => {
  expect(() => readConfig({ ...env, TWITCH_CLIENT_SECRET: '' })).toThrow('Set TWITCH_CLIENT_SECRET in .env');
});
it.each(['', '0', '-1', '1.5', '65536', 'abc'])('rejects invalid port %s', (PORT) => {
  expect(() => readConfig({ ...env, PORT })).toThrow('PORT must be an integer');
});
it('rejects a channel URL instead of a login name', () => {
  expect(() => readConfig({ ...env, TWITCH_CHANNEL: 'https://twitch.tv/cozy' })).toThrow('TWITCH_CHANNEL must');
});
