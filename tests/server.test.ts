import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { openGardenStore } from '../src/db/garden-store.js';
import { createGarden } from '../src/garden/service.js';
import { buildApp } from '../src/server/app.js';

const config: Config = {
  clientId: 'test-client', clientSecret: 'test-secret', channel: 'test_channel',
  port: 3000, growthSpeed: 1, devForceLive: false, redirectUri: 'http://localhost:3000/auth/callback',
};
const headers = { host: 'localhost:3000' };
let store: ReturnType<typeof openGardenStore>;
let app: Awaited<ReturnType<typeof buildApp>>;
let authorize = vi.fn(async (_code: string) => {});
let start = vi.fn(async () => {});

beforeEach(async () => {
  authorize = vi.fn(async (_code: string) => {});
  start = vi.fn(async () => {});
  store = openGardenStore(':memory:');
  app = await buildApp({ config, garden: createGarden(store, () => 0), auth: { authorize, userId: undefined, needsReauthorization: true, missingScopes: [] }, chat: { start, connected: false, live: false, actualLive: false } });
});
afterEach(async () => { vi.restoreAllMocks(); await app.close(); store.close(); });

async function login() {
  const response = await app.inject({ url: '/auth/login', headers });
  const redirect = new URL(response.headers.location as string);
  const state = redirect.searchParams.get('state')!;
  return { response, redirect, state, cookie: `garden_oauth_state=${state}` };
}

it('returns persisted garden JSON without requiring Twitch auth', async () => {
  const garden = createGarden(store, () => 0);
  garden.plant({ userId: '42', displayName: 'Cozy' });
  const response = await app.inject({ url: '/api/garden', headers });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ plants: garden.list() });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).not.toContain('test-secret');
});

it('requests only the user chat scopes, a code, and the registered redirect', async () => {
  const { response, redirect } = await login();
  expect(response.statusCode).toBe(302);
  expect(redirect.origin).toBe('https://id.twitch.tv');
  expect(redirect.searchParams.get('scope')).toBe('user:read:chat user:write:chat moderator:read:chatters');
  expect(redirect.searchParams.get('response_type')).toBe('code');
  expect(redirect.searchParams.get('redirect_uri')).toBe(config.redirectUri);
  expect(String(response.headers['set-cookie'])).toContain('HttpOnly');
  expect(String(response.headers['set-cookie'])).toContain('SameSite=Lax');
});

it('exchanges a valid browser-bound code once and starts chat', async () => {
  const { state, cookie } = await login();
  const url = `/auth/callback?code=test-code&state=${state}`;
  const response = await app.inject({ url, headers: { ...headers, cookie } });
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe('/');
  expect(authorize).toHaveBeenCalledExactlyOnceWith('test-code');
  expect(start).toHaveBeenCalledOnce();
  expect((await app.inject({ url, headers: { ...headers, cookie } })).statusCode).toBe(400);
  expect(authorize).toHaveBeenCalledOnce();
});

it('rejects missing, mismatched, and expired OAuth state without exchanging a code', async () => {
  const { state, cookie } = await login();
  expect((await app.inject({ url: `/auth/callback?code=x&state=${state}`, headers })).statusCode).toBe(400);
  expect((await app.inject({ url: `/auth/callback?code=x&state=${'a'.repeat(64)}`, headers: { ...headers, cookie } })).statusCode).toBe(400);
  const future = Date.now() + 11 * 60_000;
  vi.spyOn(Date, 'now').mockReturnValue(future);
  expect((await app.inject({ url: `/auth/callback?code=x&state=${state}`, headers: { ...headers, cookie } })).statusCode).toBe(400);
  expect(authorize).not.toHaveBeenCalled();
});

it('handles authorization denial and redacts upstream failures', async () => {
  const denied = await login();
  expect((await app.inject({ url: `/auth/callback?error=access_denied&state=${denied.state}`, headers: { ...headers, cookie: denied.cookie } })).statusCode).toBe(400);
  expect(authorize).not.toHaveBeenCalled();
  const accepted = await login();
  authorize.mockRejectedValueOnce(new Error('secret-from-upstream'));
  const response = await app.inject({ url: `/auth/callback?code=x&state=${accepted.state}`, headers: { ...headers, cookie: accepted.cookie } });
  expect(response.statusCode).toBe(502);
  expect(response.body).not.toContain('secret-from-upstream');
  expect(start).not.toHaveBeenCalled();
});

it('rejects a nonlocal Host header', async () => {
  const response = await app.inject({ url: '/api/garden', headers: { host: 'other.example:3000' } });
  expect(response.statusCode).toBe(403);
});

it('exposes stage progress, dormancy, recent action flags, and complete stage counts', async () => {
  const garden = createGarden(store, () => 0);
  const viewer = { userId: '42', displayName: 'Cozy' };
  garden.plant(viewer);
  garden.water(viewer, true, 6);
  const response = await app.inject({ url: '/api/garden', headers });
  expect(response.json().plants[0]).toMatchObject({
    stage: 'sprout', stage_progress: 0, growth: 30, dormant: false,
    recently_watered: true, recently_woke: false,
  });
  expect(typeof response.json().plants[0].last_watered_at).toBe('string');
  const stats = await app.inject({ url: '/api/garden/stats', headers });
  expect(stats.statusCode).toBe(200);
  expect(stats.json()).toEqual({ total: 1, by_stage: { seed: 0, sprout: 1, leafy: 0, budding: 0, bloom: 0 }, dormant: 0 });
  const status = await app.inject({ url: '/', headers });
  expect(status.json()).toMatchObject({ reauthorization_required: true, growth_live: false, dev_force_live: false });
});
