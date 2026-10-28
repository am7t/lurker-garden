import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { exchangeCode, getTokenInfo, type AccessToken, type TokenInfo } from '@twurple/auth';
import { createTwitchAuth } from '../src/twitch/auth.js';
import type { SavedToken } from '../src/twitch/token-store.js';

vi.mock('@twurple/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@twurple/auth')>(),
  exchangeCode: vi.fn(),
  getTokenInfo: vi.fn(),
}));

const config = {
  clientId: 'fake-client', clientSecret: 'fake-secret', channel: 'cozy', port: 3000,
  redirectUri: 'http://localhost:3000/auth/callback',
};
const token: AccessToken = {
  accessToken: 'fake-access', refreshToken: 'fake-refresh', scope: ['user:read:chat', 'user:write:chat'],
  expiresIn: 3600, obtainmentTimestamp: Date.now(),
};
const info = { clientId: 'fake-client', userId: '42', userName: 'cozy', scopes: token.scope } as TokenInfo;
beforeEach(() => {
  vi.mocked(exchangeCode).mockResolvedValue({ ...token });
  vi.mocked(getTokenInfo).mockResolvedValue(info);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

function fixture(saved?: SavedToken) {
  const store = { load: vi.fn(() => saved), save: vi.fn() };
  const invalid = vi.fn();
  const warn = vi.fn();
  const auth = createTwitchAuth(config, store, invalid, warn);
  return { auth, store, invalid, warn };
}

it('exchanges a code and persists a validated broadcaster token', async () => {
  const { auth, store } = fixture();
  await auth.authorize('fake-code');
  expect(exchangeCode).toHaveBeenCalledWith('fake-client', 'fake-secret', 'fake-code', config.redirectUri);
  expect(auth.userId).toBe('42');
  expect(store.save).toHaveBeenCalledWith({ clientId: 'fake-client', userId: '42', token });
});

it('restores and validates tokens without requiring another OAuth code', async () => {
  const { auth } = fixture({ clientId: 'fake-client', userId: '42', token });
  expect(await auth.restore()).toBe(true);
  expect(auth.userId).toBe('42');
  expect(getTokenInfo).toHaveBeenCalledWith('fake-access', 'fake-client');
  expect(exchangeCode).not.toHaveBeenCalled();
});

it('persists Twurple refresh events and stops the session on refresh failure', async () => {
  const { auth, store, invalid, warn } = fixture();
  await auth.authorize('fake-code');
  const refreshed = { ...token, accessToken: 'fake-new-access', refreshToken: 'fake-new-refresh' };
  // Simulate SDK-owned events without making real refresh requests to Twitch.
  const events = auth.provider as unknown as { emit(event: unknown, ...args: unknown[]): void };
  events.emit(auth.provider.onRefresh, '42', refreshed);
  expect(store.save).toHaveBeenLastCalledWith({ clientId: 'fake-client', userId: '42', token: refreshed });
  events.emit(auth.provider.onRefreshFailure, '42', new Error('fake-sensitive-upstream-details'));
  expect(auth.userId).toBeUndefined();
  expect(invalid).toHaveBeenCalledOnce();
  expect(warn).toHaveBeenCalledWith('Twitch token refresh failed. Reconnect at /auth/login.');
});

it.each([
  { ...info, userName: 'another_channel' },
  { ...info, clientId: 'another-client' },
  { ...info, scopes: ['user:read:chat'] },
])('rejects the wrong account, app, or missing scopes', async (badInfo) => {
  vi.mocked(getTokenInfo).mockResolvedValueOnce(badInfo as TokenInfo);
  const { auth, store } = fixture();
  await expect(auth.authorize('fake-code')).rejects.toThrow();
  expect(store.save).not.toHaveBeenCalled();
  expect(auth.userId).toBeUndefined();
});

it('ends a session when saved tokens fail validation', async () => {
  vi.mocked(getTokenInfo).mockRejectedValueOnce(new Error('fake-revoked-token'));
  const { auth, invalid } = fixture({ clientId: 'fake-client', userId: '42', token });
  await expect(auth.restore()).rejects.toThrow('Saved Twitch session could not be validated.');
  expect(auth.userId).toBeUndefined();
  expect(invalid).toHaveBeenCalled();
});
