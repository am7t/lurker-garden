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
  return {
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
