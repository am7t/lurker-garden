import { exchangeCode, getTokenInfo, RefreshingAuthProvider, type AccessToken, type TokenInfo } from '@twurple/auth';
import type { Config } from '../config.js';
import type { TokenStore } from './token-store.js';

export const chatScopes = ['user:read:chat', 'user:write:chat'];

export interface TwitchAuth {
  provider: RefreshingAuthProvider;
  readonly userId: string | undefined;
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

  function invalidate() {
    const previousUser = userId;
    userId = undefined;
    if (previousUser) provider.removeUser(previousUser);
    onInvalid();
  }

  function checkInfo(info: TokenInfo): string {
    if (info.clientId !== config.clientId || !info.userId
      || info.userName?.toLowerCase() !== config.channel) {
      throw new Error('Authorize using the broadcaster account configured in TWITCH_CHANNEL.');
    }
    if (!chatScopes.every((scope) => info.scopes.includes(scope))) {
      throw new Error('Both chat scopes are required. Reconnect at /auth/login.');
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
  }

  return {
    provider,
    get userId() { return userId; },
    invalidate,
    async authorize(code) {
      const token = await exchangeCode(config.clientId, config.clientSecret, code, config.redirectUri);
      await install(token);
    },
    async restore() {
      const saved = store.load();
      if (!saved) return false;
      if (saved.clientId !== config.clientId) throw new Error('Saved tokens belong to a different Twitch app.');
      userId = saved.userId;
      provider.addUser(saved.userId, saved.token);
      try {
        await this.validate();
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
