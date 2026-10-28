import { randomBytes, timingSafeEqual } from 'node:crypto';

export function createOAuthStateStore() {
  const pending = new Map<string, number>();
  return {
    issue(): string {
      const now = Date.now();
      for (const [state, expires] of pending) if (expires <= now) pending.delete(state);
      if (pending.size >= 20) pending.delete(pending.keys().next().value!);
      const state = randomBytes(32).toString('hex');
      pending.set(state, now + 10 * 60_000);
      return state;
    },
    consume(state: string | undefined, cookie: string | undefined): boolean {
      if (!state || !cookie || !/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(cookie)) return false;
      if (!timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) return false;
      const expiry = pending.get(state);
      pending.delete(state);
      return expiry !== undefined && expiry > Date.now();
    },
  };
}
