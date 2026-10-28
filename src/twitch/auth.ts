import { exchangeCode, getTokenInfo, RefreshingAuthProvider, type AccessToken, type TokenInfo } from '@twurple/auth';
import type { Config } from '../config.js';
import type { TokenStore } from './token-store.js';

export const chatScopes = ['user:read:chat', 'user:write:chat', 'moderator:read:chatters'];

export interface TwitchAuth {
  provider: RefreshingAuthProvider;
  readonly userId: string | undefined;
  readonly needsReauthorization: boolean;
  readonly missingScopes: readonly string[];
  restore(): Promise<boolean>;
  authorize(code: string): Promise<void>;
  validate(): Promise<void>;
  invalidate(): void;
}

export function createTwitchAuth(
  config: Config,
  store: TokenStore,
  onInvalid: () => void,
  warn: (message: string) => void,
): TwitchAuth {
  const provider = new RefreshingAuthProvider({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  });
  let userId: string | undefined;
  let missingScopes: string[] = [];
  let needsReauthorization = true;

  function invalidate() {
    const previousUser = userId;
    userId = undefined;
    needsReauthorization = true;
    if (previousUser) provider.removeUser(previousUser);
    onInvalid();
  }

  function checkInfo(info: TokenInfo): string {
    if (info.clientId !== config.clientId || !info.userId
      || info.userName?.toLowerCase() !== config.channel) {
      throw new Error('Authorize using the broadcaster account configured in TWITCH_CHANNEL.');
    }
    missingScopes = chatScopes.filter((scope) => !info.scopes.includes(scope));
    if (missingScopes.length) {
      needsReauthorization = true;
      throw new Error('Required Twitch scopes are missing. Reconnect at /auth/login.');
    }
    return info.userId;
  }

  provider.onRefresh((refreshedUser, token) => {
    if (refreshedUser !== userId) return;
    try {
      store.save({ clientId: config.clientId, userId: refreshedUser, token });
    } catch {
      warn('Could not persist refreshed OAuth tokens. Check data/ permissions and reconnect.');
      invalidate();
    }
  });
  provider.onRefreshFailure(() => {
    warn('Twitch token refresh failed. Reconnect at /auth/login.');
    invalidate();
  });

  async function install(token: AccessToken): Promise<void> {
    const info = await getTokenInfo(token.accessToken, config.clientId);
    const nextUser = checkInfo(info);
    if (!token.refreshToken) throw new Error('Twitch did not provide a refresh token.');
    store.save({ clientId: config.clientId, userId: nextUser, token });
    if (userId) provider.removeUser(userId);
    userId = nextUser;
    provider.addUser(nextUser, token);
    needsReauthorization = false;
  }

  return {
    provider,
    get userId() { return userId; },
    get needsReauthorization() { return needsReauthorization; },
    get missingScopes() { return [...missingScopes]; },
    invalidate,
    async authorize(code) {
      const token = await exchangeCode(config.clientId, config.clientSecret, code, config.redirectUri);
      await install(token);
    },
    async restore() {
      const saved = store.load();
      if (!saved) return false;
      if (saved.clientId !== config.clientId) throw new Error('Saved tokens belong to a different Twitch app.');
      missingScopes = chatScopes.filter((scope) => !saved.token.scope.includes(scope));
      if (missingScopes.length) {
        needsReauthorization = true;
        warn('Saved Twitch token needs new permissions. Re-authorize at /auth/login for moderator:read:chatters.');
        return false;
      }
      userId = saved.userId;
      provider.addUser(saved.userId, saved.token);
      try {
        await this.validate();
        needsReauthorization = false;
        return true;
      } catch {
        invalidate();
        throw new Error('Saved Twitch session could not be validated. Reconnect at /auth/login.');
      }
    },
    async validate() {
      if (!userId) return;
      const currentUser = userId;
      // Twurple refreshes expired tokens here; /validate also detects revoked grants.
      const token = await provider.getAccessTokenForUser(currentUser);
      if (!token) throw new Error('No Twitch user token is available.');
      const info = await getTokenInfo(token.accessToken, config.clientId);
      if (checkInfo(info) !== currentUser) throw new Error('Twitch token user changed.');
    },
  };
}
