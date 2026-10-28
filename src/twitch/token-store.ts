import type { AccessToken } from '@twurple/auth';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SavedToken {
  clientId: string;
  userId: string;
  token: AccessToken;
}

export function createTokenStore(filename: string) {
  return {
    load(): SavedToken | undefined {
      if (!existsSync(filename)) return undefined;
      try {
        const saved = JSON.parse(readFileSync(filename, 'utf8')) as SavedToken;
        if (!saved || typeof saved.clientId !== 'string' || typeof saved.userId !== 'string'
          || typeof saved.token?.accessToken !== 'string'
          || typeof saved.token.refreshToken !== 'string'
          || !Array.isArray(saved.token.scope)
          || !saved.token.scope.every((scope) => typeof scope === 'string')
          || !Number.isFinite(saved.token.obtainmentTimestamp)
          || (saved.token.expiresIn !== null && !Number.isFinite(saved.token.expiresIn))) {
          throw new Error('Invalid token file');
        }
        chmodSync(filename, 0o600);
        return saved;
      } catch {
        throw new Error('Could not load local OAuth tokens. Reconnect at /auth/login.');
      }
    },
    save(saved: SavedToken): void {
      mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
      // Replace atomically so a restart cannot leave a half-written refresh token.
      const temporary = `${filename}.tmp`;
      writeFileSync(temporary, JSON.stringify(saved), { mode: 0o600 });
      chmodSync(temporary, 0o600);
      renameSync(temporary, filename);
    },
  };
}

export type TokenStore = ReturnType<typeof createTokenStore>;
