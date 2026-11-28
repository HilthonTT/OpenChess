# Running the server

Needs [Bun](https://bun.sh) 1.3+ and a PostgreSQL database.

```sh
bun install
cp .env.example .env
bun run db:migrate:deploy
bun run db:seed
bun run dev:server   # the API, on http://localhost:3000
```

Interactive API docs at `/reference`, the raw OpenAPI document at `/doc`.

Each [release](https://github.com/HilthonTT/OpenChess/releases/latest) also
carries `openchess-server-<version>-<platform>`, the API as a single binary. It is
configured from the same environment and still needs PostgreSQL with the
migrations applied.

## Environment

Bun loads the workspace-root `.env` for every package. The server validates its
variables at boot and refuses to start if one is missing or malformed:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `production` hides error details and tightens key checks |
| `PORT` | no | `9999` | `.env.example` sets `3000` |
| `LOG_LEVEL` | yes | — | `fatal`…`trace`, or `silent` |
| `DATABASE_URL` | yes | — | A PostgreSQL connection string |
| `ALLOWED_ORIGINS` | no | — | Comma-separated CORS allowlist for production |
| `PUBLIC_BASE_URL` | in prod | localhost | Origin used for Polar post-checkout redirects |
| `CLERK_SECRET_KEY` | yes | — | Live key (`sk_live_`) enforced in production |
| `CLERK_PUBLISHABLE_KEY` | yes | — | |
| `CLERK_OAUTH_CLIENT_ID` | in prod | — | Also read by the CLI to run the sign-in flow |
| `SENTRY_DSN` | no | — | Unset runs without Sentry entirely |
| `SENTRY_TRACES_SAMPLE_RATE` | no | `1` | Fraction of requests traced, 0–1 |
| `POLAR_ACCESS_TOKEN` | yes | — | From the Polar dashboard for `POLAR_SERVER`'s environment |
| `POLAR_PRODUCT_ID` | yes | — | |
| `POLAR_SERVER` | no | `sandbox` | Must be `production` when `NODE_ENV=production` |
| `INNGEST_DEV` | dev only | — | Must be UNSET in production (disables request signing) |
| `INNGEST_SIGNING_KEY` | in prod | — | Verifies that `/api/inngest` requests come from Inngest |
| `UPSTASH_REDIS_REST_URL` | see note | — | Read cache, matchmaking queue, live-game change counter |
| `UPSTASH_REDIS_REST_TOKEN` | see note | — | Must be set together with the URL, or neither |

Without the Upstash pair the server runs uncached, keeps the matchmaking queue in
process, and reloads a game on each stream tick — slower, not broken. **Set it
before running more than one instance**: an in-process queue means one queue per
instance, and two players on different instances would wait forever beside each
other.

## Database

```sh
bun run db:generate        # regenerate the Prisma client from the schema
bun run db:migrate         # create and apply a migration — development
bun run db:migrate:deploy  # apply pending migrations — production
bun run db:migrate:status  # what is applied, and what is pending
bun run db:seed            # achievement, title and puzzle catalogs
```

Run `db:migrate:status` after pulling: `db:generate` on its own leaves the client
expecting columns the database has not been told about, and every read of that
table then fails at once. The seed is idempotent — it upserts by `code` (and
`externalId` for puzzles), so rerunning it updates copy, rewards and prices
without touching anything players have earned.

### Puzzles

The built-in puzzle catalog is a dozen hand-authored positions, each checked
against the engine by `puzzle-catalog.test.ts`. For a real corpus, import the
[Lichess database](https://database.lichess.org/#puzzles) (CC0, already in the
format this speaks):

```sh
curl -O https://database.lichess.org/lichess_db_puzzle.csv.zst
zstd -d lichess_db_puzzle.csv.zst
bun run db:import-puzzles lichess_db_puzzle.csv --limit 20000
```

Every row is replayed through the engine first, and one that will not replay is
counted and skipped rather than failing the import. Rows upsert by `externalId`,
so a rerun against a newer dump refreshes ratings in place and leaves players'
attempts attached. `--min-rating` / `--max-rating` narrow the band (400–2400).

## Live games

`GET /api/games/{id}/events` is a
[Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
stream, and the one route not in the OpenAPI document — its body is a stream
rather than a modelled response. It emits `state` events whose data is exactly the
body of `GET /api/games/{id}`: one on connect, one on every change. Same auth as
every other game route.

- **A settled game stays open for ninety seconds**, because what people say in a
  chess game is said *after* it and a stream that hung up on the final move would
  deliver everything except "good game". A game already over when the stream opens
  gets one state event, then a hang-up.
- **Not every change is a move.** A draw offer and a message move neither the ply
  nor the result, so compare `drawOfferFrom` and the last id in `chat` too — and
  treat them differently: a move clears a held selection, a message must not.
  Being told "nice move" should not put your piece back down.
- **`/watch/events` is the spectators' feed**, on the same loop, carrying the
  narrower `/watch` body — no legal moves, since there is nothing a watcher could
  act on, and no chat, since the two people playing did not sign up to be overheard.

A move made on the same instance is pushed the moment it commits; one made on
another instance is caught by a change counter in Redis that each stream re-checks
on a tick, since Upstash speaks REST and has no pub/sub. The matchmaking queue
stays polled on purpose: a poll *is* the "still here" heartbeat the server pairs on.

## API errors

Every unsuccessful response is [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)
problem details, served as `application/problem+json`. `requestId` matches the
`x-request-id` header and the server log line, so a report from a client can be traced
to what actually happened.

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "No route matched GET /nope",
  "instance": "/nope",
  "requestId": "cf130122-f1b1-43f6-beb5-720a8693abfe"
}
```

Validation failures carry `"type": "/problems/validation-error"`, a `422`, and an
`errors` array naming each offending field:

```json
"errors": [
  { "path": "name", "message": "Too small: expected string to have >=3 characters", "code": "too_small" }
]
```

Unhandled errors return a bare `500` in production. Outside production they also
include `detail` and `stack` — convenient locally, a leak if it ever shipped, so keep
`NODE_ENV=production` set in production.
