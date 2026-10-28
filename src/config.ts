import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Resolves to the repository root in both src/ and compiled dist/.
export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export interface Config {
  clientId: string;
  clientSecret: string;
  channel: string;
  port: number;
  redirectUri: string;
  growthSpeed: number;
  devForceLive: boolean;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (key: string): string => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Set ${key} in .env before starting Lurker Garden.`);
    return value;
  };
  const channel = required('TWITCH_CHANNEL').toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(channel)) {
    throw new Error('TWITCH_CHANNEL must be a channel login name without # or a URL.');
  }
  const port = Number(env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535.');
  }
  const growthSpeed = Number(env.GROWTH_SPEED ?? '1');
  if (!Number.isFinite(growthSpeed) || growthSpeed <= 0 || growthSpeed > 10_000) {
    throw new Error('GROWTH_SPEED must be greater than 0 and at most 10000.');
  }
  const forceLive = env.DEV_FORCE_LIVE ?? 'false';
  if (forceLive !== 'true' && forceLive !== 'false') throw new Error('DEV_FORCE_LIVE must be true or false.');
  return {
    growthSpeed,
    devForceLive: forceLive === 'true',
    clientId: required('TWITCH_CLIENT_ID'),
    clientSecret: required('TWITCH_CLIENT_SECRET'),
    channel,
    port,
    redirectUri: `http://localhost:${port}/auth/callback`,
  };
}

export function loadConfig(): Config {
  loadEnv({ path: `${projectRoot}/.env`, quiet: true });
  return readConfig();
}
