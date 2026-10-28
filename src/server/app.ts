import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import type { Config } from '../config.js';
import type { Garden } from '../garden/service.js';
import { chatScopes, type TwitchAuth } from '../twitch/auth.js';
import type { TwitchChat } from '../twitch/chat.js';
import { createOAuthStateStore } from './oauth-state.js';

interface AppDependencies {
  config: Config;
  garden: Garden;
  auth: Pick<TwitchAuth, 'authorize' | 'userId'>;
  chat: Pick<TwitchChat, 'start' | 'connected'>;
  logger?: boolean;
}

export async function buildApp({ config, garden, auth, chat, logger = false }: AppDependencies) {
  // OAuth callback URLs contain codes: never enable automatic request/URL logging.
  const app = Fastify({ logger, logController: new LogController({ disableRequestLogging: true }) });
  await app.register(cookie);
  const states = createOAuthStateStore();
  let authorizing = false;
  const allowedHosts = new Set([`localhost:${config.port}`, `127.0.0.1:${config.port}`, `[::1]:${config.port}`]);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (!allowedHosts.has(request.headers.host ?? '')) {
      return reply.code(403).send({ error: 'Use the local Lurker Garden URL.' });
    }
  });
  app.setErrorHandler((_error, _request, reply) => {
    app.log.error('A request failed. No credentials or callback parameters were logged.');
    return reply.code(500).send({ error: 'Request failed. Check local configuration and try again.' });
  });

  app.get('/', async () => ({
    name: 'Lurker Garden',
    channel: config.channel,
    authenticated: Boolean(auth.userId),
    chat_connected: chat.connected,
    login: '/auth/login',
    garden: '/api/garden',
  }));
  app.get('/api/garden', async () => ({ plants: garden.list() }));

  app.get('/auth/login', async (_request, reply) => {
    const state = states.issue();
    reply.setCookie('garden_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/auth',
      maxAge: 600,
      // Local HTTP only; this app binds to loopback and is not a hosted service.
      secure: false,
    });
    const url = new URL('https://id.twitch.tv/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: chatScopes.join(' '),
      state,
      force_verify: 'true',
    }).toString();
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/auth/callback', async (request, reply) => {
    reply.clearCookie('garden_oauth_state', { path: '/auth' });
    const { code, state, error } = request.query;
    if (typeof state !== 'string' || !states.consume(state, request.cookies.garden_oauth_state)) {
      return reply.code(400).send({ error: 'OAuth state expired or invalid. Start again at /auth/login.' });
    }
    if (error || typeof code !== 'string' || !code) {
      return reply.code(400).send({ error: 'Twitch authorization was declined or incomplete. Try /auth/login.' });
    }
    if (authorizing) return reply.code(409).send({ error: 'Another authorization is in progress. Try again shortly.' });
    authorizing = true;
    try {
      await auth.authorize(code);
      await chat.start();
      return reply.redirect('/');
    } catch {
      app.log.warn('Twitch authorization or chat setup failed. Check credentials, broadcaster account, and chat scopes.');
      return reply.code(502).send({
        error: 'Could not connect to Twitch. Check .env, authorize the TWITCH_CHANNEL account, and retry /auth/login.',
      });
    } finally {
      authorizing = false;
    }
  });
  return app;
}
