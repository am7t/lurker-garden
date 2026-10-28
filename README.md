# Lurker Garden

A cozy, persistent Twitch community garden for the Codex x TwitchCon hackathon. A viewer types `!lurk` to plant a seed. This foundation includes local OAuth, EventSub chat, SQLite persistence, and a JSON API. Overlay visuals, growth over time, follows, subscriptions, and raids come later.

## Run locally

Requires Node **20.19+** and npm. `.nvmrc` selects Node 20; Node 22 also works. If your platform has no prebuilt `better-sqlite3` binary, installation needs Python and a C++ build toolchain (Xcode Command Line Tools on macOS).

```sh
git clone https://github.com/am7t/lurker-garden.git
cd lurker-garden
npm ci
cp .env.example .env
chmod 600 .env
```

If you already configured `.env`, keep it. Fill these values in locally:

| Variable | Value |
| --- | --- |
| `TWITCH_CLIENT_ID` | Your registered Twitch application's Client ID |
| `TWITCH_CLIENT_SECRET` | The confidential application's Client Secret; never paste it into chat or commit it |
| `TWITCH_CHANNEL` | Broadcaster login name, e.g. `dnkies`, without `#` or a URL |
| `PORT` | `3000` by default |

```sh
npm run dev
```

Open **http://localhost:3000/auth/login**, log in as the broadcaster named in `TWITCH_CHANNEL`, and approve the two chat permissions. Your own Twitch account sends the garden replies. A separate bot account is outside this first pass. The root URL reports authentication and chat subscription status; `chat_connected` may take a moment to become true.

Once connected, type `!lurk` in that channel's chat and open **http://localhost:3000/api/garden**. Restart the server and the same plant and OAuth session should remain. Keep the process running to receive messages; events missed while offline are not replayed by Twitch.

For a compiled run:

```sh
npm run build
npm start
```

The server binds only to localhost. It has no public hosting, tunnel, overlay, or CORS configuration. OAuth always uses `http://localhost:PORT/auth/callback`; if you change `PORT`, update the exact URL in Twitch's console too. Use `localhost` for the login flow so the state cookie is sent back to the same host.

## Twitch application

In the [developer console](https://dev.twitch.tv/console/apps), register:

- Name: `lurker-garden-dev`
- OAuth Redirect URL: `http://localhost:3000/auth/callback`
- Category: **Chat Bot**
- Client type: **Confidential**

Generate the Client Secret yourself and enter it directly into `.env`. Twitch login and 2FA remain yours to handle. No secret, token, or OAuth code is returned by the garden API or included in request logs.

This local installed chatbot requests **`user:read:chat`** for `channel.chat.message` over EventSub WebSockets and **`user:write:chat`** for replies through Helix Send Chat Message. It uses a **user access token**. No IRC client or IRC scopes are used. Additional cloud bot scopes such as `user:bot` and `channel:bot` are not required for this transport and broadcaster-account setup. See [Twitch's authentication guide](https://dev.twitch.tv/docs/chat/authenticating/) and [chat subscription authorization](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channel-chat-message).

OAuth uses an expiring, single-use state bound to an HttpOnly browser cookie. `@twurple/auth` handles token refresh. Tokens save atomically to `data/tokens.json` with owner-only file permissions, including on refresh. Startup and hourly checks validate the Twitch session, as [Twitch requires](https://dev.twitch.tv/docs/authentication/validate-tokens/). A failed validation stops chat; reconnect through `/auth/login`. Twurple manages WebSocket keepalives, reconnects, and subscriptions.

## Garden behavior and API

- One plant per Twitch user ID. Display names update on any later chat message.
- `!lurk` (case-insensitive, optionally followed by text) creates a seed with growth `0`, stage `seed`, and UTC ISO timestamps for `planted_at` and `last_seen`.
- Repeating `!lurk` keeps the original species, planting date, growth, and stage, then replies with that plant's name and stage.
- New planting weights live in [`src/garden/species.config.ts`](src/garden/species.config.ts): daisy 30, tulip 25, fern 25, sunflower 15, moonflower 3, glowing mushroom 1.5, crystal bloom 0.5. Weights are relative and may be edited; existing plants keep their species.
- Normal chat updates `last_seen` only for existing plants. It never creates a plant.
- Short-term duplicate EventSub deliveries are ignored. SQLite transactions and the primary key protect against duplicate plants. If a reply fails, the plant stays saved; a later `!lurk` reports the existing plant.
- Messages originating in another channel's Shared Chat are ignored.

`GET /api/garden` returns `{ "plants": [...] }` (or an empty array before planting). A plant looks like:

```json
{
  "user_id": "1234",
  "display_name": "CozyViewer",
  "species": "fern",
  "planted_at": "2026-10-28T12:00:00.000Z",
  "last_seen": "2026-10-28T12:00:00.000Z",
  "growth": 0,
  "stage": "seed"
}
```

Growth remains zero in this pass. Future stage values are reserved in the schema, but no timer or events advance them yet.

## Structure and checks

```text
src/config.ts             Environment loading and validation
src/index.ts              Startup, session checks, shutdown
src/server/               Fastify routes and OAuth state
src/twitch/               OAuth, token storage, EventSub chat adapter
src/garden/               Pure planting/species functions and garden service
src/db/                   SQLite schema and repository
tests/                    Species, planting, persistence, chat, auth, routes, config
```

```sh
npm test
npm run typecheck
npm run build
```

Tests use synthetic credentials and temporary databases; they do not read `.env` or contact Twitch. CI runs the same checks on Node 20 and 22. Vitest is pinned to a patched Node-20-compatible release. `light-my-request` is pinned through an override to keep Fastify's injection dependency compatible with Node 20; `@fastify/cookie` is also pinned for that reason.

## Local data and troubleshooting

`.env`, all of `data/`, SQLite databases, journal/WAL sidecars, and build outputs are gitignored. `data/garden.sqlite` persists across streams and restarts. Back up the whole `data/` directory while the server is stopped; keep token backups private. Deleting only `data/tokens.json` while stopped resets login without removing plants. Deleting the garden database removes the garden.

- **Missing credentials or startup failure:** fill in all `.env` values, keep `PORT` numeric and available, and make sure `data/` is writable. Restart after editing `.env`.
- **Redirect mismatch:** use the exact registered callback URL, including HTTP, port, and path.
- **Authorization fails:** sign in with the configured broadcaster account and grant both chat scopes. Reopen `/auth/login` if the state expires or the server restarts during login.
- **Chat subscription fails:** inspect the root status and reconnect at `/auth/login`. Only run one local instance against the same data directory.
- **Reply missing:** check channel moderation, chat rate limits, and Twitch connectivity. Planting commits before the reply is attempted.
- **Revoked authorization or temporary validation failure:** chat stops rather than using an unvalidated session. Reconnect at `/auth/login`, or restart to retry a saved session after a temporary network outage.

Suggested next step: manually verify `!lurk` and persistence in your Twitch channel, then build the overlay against `/api/garden`.

MIT licensed; see [LICENSE](LICENSE).
