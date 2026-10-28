# Lurker Garden

A persistent Twitch community garden for the Codex x TwitchCon hackathon. Viewers type `!lurk` to plant and `!water` for a little boost. Silent lurkers grow too: the app samples the channel's chatter list while the stream is live. This pass includes game logic and Twitch presence; overlay visuals, follows, subs, and raids come later.

## Run locally

Requires Node **20.19+** and npm. `.nvmrc` selects Node 20; CI also checks Node 22. If `better-sqlite3` has no prebuilt binary for your platform, installation needs Python and a C++ toolchain (Xcode Command Line Tools on macOS).

```sh
git clone https://github.com/am7t/lurker-garden.git
cd lurker-garden
npm ci
cp .env.example .env
chmod 600 .env
```

Keep an existing `.env` instead of overwriting it. Fill credentials locally; never paste the Client Secret into chat or commit it.

| Variable | Default / meaning |
| --- | --- |
| `TWITCH_CLIENT_ID` | Your Twitch application's Client ID |
| `TWITCH_CLIENT_SECRET` | Your confidential application's Client Secret |
| `TWITCH_CHANNEL` | Broadcaster login, e.g. `dnkies`, without `#` or a URL |
| `PORT` | `3000` |
| `GROWTH_SPEED` | `1`; positive multiplier, at most `10000`, for tick points and water boosts |
| `DEV_FORCE_LIVE` | `false`; `true` allows growth while the real stream is offline |

```sh
npm run dev
```

Open **http://localhost:3000/auth/login** and authorize as the broadcaster in `TWITCH_CHANNEL`. Replies come from that account. A separate bot account is outside this implementation. The root JSON reports authentication, missing scopes, chat connection, actual stream status (`stream_live`), effective growth status (`growth_live`), and demo settings.

For a compiled run, use `npm run build` followed by `npm start`. The server binds only to localhost. OAuth uses `http://localhost:PORT/auth/callback`; update Twitch's registered URL if you change the port. Use `localhost` throughout login so the browser sends its state cookie back to the same host.

## Twitch setup and reauthorization

Register in the [developer console](https://dev.twitch.tv/console/apps) with name `lurker-garden-dev`, redirect `http://localhost:3000/auth/callback`, category **Chat Bot**, and client type **Confidential**. Generate the secret yourself and enter it into `.env`.

**Existing installations must re-authorize once for `moderator:read:chatters`.** Visit `/auth/login` and approve the new permission. A stored foundation token without it keeps the server and garden API available, but chat/presence stay disconnected. The root status shows `reauthorization_required: true` and the missing scope; the old token and plants are preserved until you reconnect.

The complete scope set is:

- `user:read:chat`: receive `channel.chat.message` through EventSub WebSockets.
- `user:write:chat`: send replies through Helix.
- `moderator:read:chatters`: list channel chatters using the broadcaster token, whose user ID also supplies `moderator_id`.

`stream.online` and `stream.offline` need no additional scopes. This installed chatbot uses user tokens, no IRC, and no cloud bot scopes. See [Get Chatters](https://dev.twitch.tv/docs/api/reference/#get-chatters), [EventSub subscription types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#stream-online), and [Twitch chatbot authentication](https://dev.twitch.tv/docs/chat/authenticating/).

OAuth uses single-use, expiring state bound to an HttpOnly cookie. Twurple refreshes tokens and saves them atomically to `data/tokens.json` with owner-only permissions. Startup and hourly token validation follow [Twitch's requirements](https://dev.twitch.tv/docs/authentication/validate-tokens/). Failed validation stops chat; reconnect at `/auth/login`. No secret, token, or callback code is returned by the API or printed in request logs.

## Growth and presence

One plant belongs to each Twitch user ID. Its species is rolled once from [`src/garden/species.config.ts`](src/garden/species.config.ts); repeat `!lurk` keeps its species, original planting date, growth, and stage. Display names and `last_seen` update on chat messages and successful chatter scans. Unknown chatters never receive plants automatically. Messages originating in another channel's Shared Chat are ignored.

All balance settings live beside the species table in [`src/garden/growth.config.ts`](src/garden/growth.config.ts):

| Stage | Total growth | Watch time without watering, speed 1 |
| --- | ---: | ---: |
| seed | 0 | 0 |
| sprout | 30 | 30 minutes |
| leafy | 120 | 2 hours |
| budding | 240 | 4 hours |
| bloom | 420 | 7 hours |

Presence adds **one point per successful live tick**. Regular watering brings bloom closer to six hours. Growth can continue accumulating at bloom; progress stays at `1`. Changing thresholds recomputes stage/progress from the retained growth total.

The app subscribes to stream online/offline events and queries Get Streams after subscriptions become ready, including after reconnecting mid-stream. A newer stream event wins over a pending startup query. It waits at least a full live minute before granting a presence tick. Disconnects and authorization loss pause growth.

While live, a scan begins no sooner than one minute after the preceding scan completes. Get Chatters requests up to 1,000 users per page, follows every pagination cursor, and deduplicates IDs. Twurple's API rate limiter honors Twitch limits across requests. Scans never overlap. A failed page skips the entire tick; offline/disconnect changes discard in-flight results. Missed ticks and server downtime are not backfilled. Restarting or reconnecting cannot award multiple ticks within the same minute for a plant.

Twitch's chatter list can lag joins/leaves and indicates connection to chat, rather than proof of watching video. Growth is sampled presence. Keep the app running to observe it.

### Watering and dormancy

`!water` waters the viewer's own plant for **five points**, at most once every **30 real minutes**. Its reply explains the remaining wait in minutes or seconds. A viewer without a plant is invited to use `!lurk`. Offline watering gives a resting message and does not consume a cooldown. `GROWTH_SPEED` multiplies the boost but leaves the cooldown unchanged.

At **seven days** without presence, a plant becomes dormant. Nothing is deleted and growth is never reduced. Dormancy maintenance runs at startup and every minute, even offline or before reauthorization; API reads also refresh it. A chat message or chatter-list appearance wakes the plant immediately when observed and records `woke_at`. A successful water records `last_watered_at`. Water cooldowns and wake timestamps survive restarts.

### Offline demo

In your local `.env`, set:

```dotenv
GROWTH_SPEED=60
DEV_FORCE_LIVE=true
```

Restart the server, complete the new OAuth grant, keep your Twitch chat open, and type `!lurk`. Stay connected to chat without typing: a successful minute scan adds 60 points, so bloom takes about seven minutes without watering. Use `!water` twice to see a boost and a cooldown reply. Polling still runs about once a minute; cooldowns and seven-day dormancy still use real time. The first tick waits a full minute after connection.

**Demo points persist in the same garden.** For normal streams, return to `GROWTH_SPEED=1` and `DEV_FORCE_LIVE=false`, then restart. Forced live does not invent viewers or bypass Twitch authorization.

## Garden API and events

`GET /api/garden` returns `{ "plants": [...] }`. Existing fields remain, with growth state and animation hints added:

```json
{
  "user_id": "1234",
  "display_name": "CozyViewer",
  "species": "fern",
  "planted_at": "2026-10-28T12:00:00.000Z",
  "last_seen": "2026-10-28T13:00:00.000Z",
  "growth": 60,
  "stage": "sprout",
  "stage_progress": 0.3333333333333333,
  "last_growth_at": "2026-10-28T13:00:00.000Z",
  "last_watered_at": null,
  "dormant": false,
  "woke_at": null,
  "recently_woke": false,
  "recently_watered": false
}
```

`stage_progress` ranges from `0` to `1` between this stage's threshold and the next; bloom reports `1`. Action flags are true for 15 seconds after their persisted timestamp. API access does not consume them, so multiple future clients can observe the same action.

`GET /api/garden/stats` returns:

```json
{
  "total": 1,
  "by_stage": { "seed": 0, "sprout": 1, "leafy": 0, "budding": 0, "bloom": 0 },
  "dormant": 0
}
```

The garden service exposes a small **in-process event emitter**, ready to forward to a future overlay transport:

```ts
const unsubscribe = garden.events.subscribe((event) => {
  // event.type: planted | stage_up | watered | woke
  // event.at: UTC ISO timestamp; event.plant: the committed plant state
});
// Call unsubscribe() when the consumer closes.
```

Events publish after the SQLite transaction commits. A large boost emits one `stage_up` with the final stage. Events are not durable or replayed; after restarting a consumer, fetch the garden and its timestamps. This pass does not expose an SSE endpoint or build overlay visuals.

## Persistence, migration, and structure

Startup automatically migrates the original unversioned database to schema version 1 in a transaction. It rebuilds the old SQLite stage constraint, preserves each plant's ID/name/species/growth/timestamps, computes the stage and progress from its growth, and initializes water/wake/growth timestamps to null and dormant to false. Maintenance immediately applies current dormancy rules. Migration is idempotent; failure rolls back, and an unknown newer database version is rejected.

`.env`, `data/`, SQLite databases and sidecars, and build outputs remain gitignored. Keep one server instance per data directory. Back up `data/` while stopped and keep token backups private. The development installation also has an ignored `data/garden.before-growth.sqlite` backup from before this migration. Deleting only `data/tokens.json` while stopped resets login without removing plants.

```text
src/config.ts             Environment validation
src/index.ts              Startup, session/dormancy maintenance, shutdown
src/server/               Fastify garden/stats/OAuth routes
src/twitch/               Auth, refresh storage, chat commands, live presence polling
src/garden/               Pure growth/dormancy/stage/water rules, balance tables, event bus
src/db/                   Versioned migration and SQLite repository
```

```sh
npm test
npm run typecheck
npm run build
```

Tests use synthetic credentials, injected times, fake timers, and temporary databases; they do not read `.env` or contact Twitch. They cover growth thresholds, live ticks, cooldowns, wake rules, pagination, race cancellation, old scopes, persistence, migration, and API output. CI runs checks on Node 20 and 22. Dependency pins keep Fastify injection/cookies compatible with Node 20.

If setup fails, check `.env` values, port availability, exact OAuth redirect, and `data/` permissions. Reconnect at `/auth/login` after revoked grants or failed session validation. Check channel restrictions if chat replies are dropped; plant changes commit before replies are attempted.

MIT licensed; see [LICENSE](LICENSE).
