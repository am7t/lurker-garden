import { join } from 'node:path';
import { loadConfig, projectRoot } from './config.js';
import { openGardenStore } from './db/garden-store.js';
import { createGarden } from './garden/service.js';
import { buildApp } from './server/app.js';
import { createTwitchAuth } from './twitch/auth.js';
import { createTwitchChat, type TwitchChat } from './twitch/chat.js';
import { createTokenStore } from './twitch/token-store.js';

async function main() {
  const config = loadConfig();
  const store = openGardenStore(join(projectRoot, 'data/garden.sqlite'));
  const garden = createGarden(store);
  let chat: TwitchChat | undefined;
  const auth = createTwitchAuth(
    config,
    createTokenStore(join(projectRoot, 'data/tokens.json')),
    () => chat?.stop(),
    (message) => console.warn(message),
  );
  chat = createTwitchChat(auth, config.channel, garden, console);
  const app = await buildApp({ config, garden, auth, chat, logger: true });
  const activeChat = chat;
  let validating = false;
  // Twitch requires token validation on startup and at least hourly thereafter.
  const validationTimer = setInterval(() => {
    if (validating || !auth.userId) return;
    validating = true;
    void auth.validate().catch(() => {
      auth.invalidate();
      app.log.warn('Twitch session validation failed; chat stopped. Reconnect at /auth/login.');
    }).finally(() => { validating = false; });
  }, 60 * 60_000);
  validationTimer.unref();

  app.addHook('onClose', async () => {
    clearInterval(validationTimer);
    activeChat.stop();
    store.close();
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().catch(() => { process.exitCode = 1; });
    });
  }
  try {
    await app.listen({ port: config.port, host: 'localhost' });
    try {
      if (await auth.restore()) await activeChat.start();
      else app.log.info(`Connect Twitch at http://localhost:${config.port}/auth/login`);
    } catch {
      auth.invalidate();
      app.log.warn(`Could not restore Twitch chat. Reconnect at http://localhost:${config.port}/auth/login`);
    }
  } catch {
    await app.close();
    throw new Error('Could not start the server. Check that PORT is available.');
  }
}

void main().catch(() => {
  // Do not print SDK errors: they can contain OAuth request details.
  console.error('Lurker Garden could not start. Check .env values, PORT availability, and data/ permissions.');
  process.exitCode = 1;
});
