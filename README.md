# OpenChess

Chess, in your terminal.

[![Bun](https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://react.dev)
[![OpenTUI](https://img.shields.io/badge/OpenTUI-terminal_UI-5A45FF)](https://github.com/sst/opentui)
[![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white)](https://hono.dev)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Clerk](https://img.shields.io/badge/Clerk-6C47FF?logo=clerk&logoColor=white)](https://clerk.com)
[![Polar](https://img.shields.io/badge/Polar-0062FF)](https://polar.sh)
[![Sentry](https://img.shields.io/badge/Sentry-362D59?logo=sentry&logoColor=white)](https://sentry.io)
[![Inngest](https://img.shields.io/badge/Inngest-000000)](https://www.inngest.com)
[![Zod](https://img.shields.io/badge/Zod-3E67B1?logo=zod&logoColor=white)](https://zod.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A TUI chess game with a full progression system behind it: play locally or
against the engine, earn XP and coins, unlock achievements, climb the
leaderboard, and spend your winnings on titles — all without leaving the
terminal.

- **Local 1v1** — two players sharing one keyboard, no account needed
- **Play vs AI** — three difficulties; server games pay out XP and coins
- **Online 1v1** — matched against the next player in the queue; the only
  games that move your Elo rating, and they pay the biggest rewards
- **Leaderboard** — ranked by rating, level or wins
- **Achievements** — one-time XP/coin bonuses, some of them secret
- **Stats** — your record, streaks, rating and level progress
- **Store** — buy titles with coins and wear one on the leaderboard
- **30+ themes** — the whole UI and board repaint from one picker

All the chess rules are enforced: castling, en passant, promotion, checkmate,
stalemate, the fifty-move rule, threefold repetition, and insufficient material.

## Layout

| Package                                | What it is                                                       |
| -------------------------------------- | ---------------------------------------------------------------- |
| [`packages/cli`](packages/cli)         | The game — an [OpenTUI](https://github.com/sst/opentui) React app |
| [`packages/server`](packages/server)   | The HTTP API — [Hono](https://hono.dev) with OpenAPI docs        |
| [`packages/database`](packages/database) | The [Prisma](https://www.prisma.io) schema and client, on PostgreSQL |
| [`packages/shared`](packages/shared)   | The chess engine and progression rules both sides agree on       |

## Requirements

- [Bun](https://bun.sh) 1.3 or newer
- A PostgreSQL database

## Setup

```sh
bun install
cp .env.example .env
```

Bun loads the workspace-root `.env` for every package. The server validates its
variables at boot and refuses to start if one is missing or malformed:

| Variable                    | Required | Default       | Notes                                                    |
| --------------------------- | -------- | ------------- | -------------------------------------------------------- |
| `NODE_ENV`                  | no       | `development` | `production` hides error details and tightens key checks |
| `PORT`                      | no       | `9999`        | `.env.example` sets `3000`                               |
| `LOG_LEVEL`                 | yes      | —             | `fatal`…`trace`, or `silent`                             |
| `DATABASE_URL`              | yes      | —             | A PostgreSQL connection string                           |
| `ALLOWED_ORIGINS`           | no       | —             | Comma-separated CORS allowlist for production            |
| `PUBLIC_BASE_URL`           | in prod  | localhost     | Origin used for Polar post-checkout redirects            |
| `CLERK_SECRET_KEY`          | yes      | —             | Live key (`sk_live_`) enforced in production             |
| `CLERK_PUBLISHABLE_KEY`     | yes      | —             |                                                          |
| `CLERK_OAUTH_CLIENT_ID`     | in prod  | —             | Also read by the CLI to run the sign-in flow             |
| `SENTRY_DSN`                | no       | —             | Unset runs without Sentry entirely                       |
| `SENTRY_TRACES_SAMPLE_RATE` | no       | `1`           | Fraction of requests traced, 0–1                         |
| `POLAR_ACCESS_TOKEN`        | yes      | —             | From the Polar dashboard for `POLAR_SERVER`'s environment |
| `POLAR_PRODUCT_ID`          | yes      | —             |                                                          |
| `POLAR_SERVER`              | no       | `sandbox`     | Must be `production` when `NODE_ENV=production`          |
| `INNGEST_DEV`               | dev only | —             | Must be UNSET in production (disables request signing)   |
| `INNGEST_SIGNING_KEY`       | in prod  | —             | Verifies that `/api/inngest` requests come from Inngest  |

The CLI additionally reads `API_URL` (defaults to `http://localhost:3000/api`)
and `OPENCHESS_FPS` (defaults to `60`).

### Database

```sh
cd packages/database
bun run db:generate            # generate the Prisma client
bunx prisma migrate dev        # apply migrations
cd ../..
bun run db:seed                # seed the achievement and title catalogs
```

The seed is idempotent — it upserts by `code`, so rerunning it updates copy,
rewards and prices in place without touching anything players have earned.

## Running

```sh
bun run dev:cli      # the game
bun run dev:server   # the API, on http://localhost:3000
```

Interactive API docs are served at `/reference`, and the raw OpenAPI document at
`/doc`.

## Playing

Pick a screen from the menu with `↑↓` and `enter`, or press `1`–`8`. `ctrl + .`
opens the theme picker, `ctrl + l` signs you in or out, and `q` quits. Online
features (leaderboard, achievements, stats, store) need an account; sign-in
opens your browser and hands the token back to the CLI.

At the board:

| Key            | Action                                    |
| -------------- | ----------------------------------------- |
| `↑↓←→`, `hjkl` | Move the cursor                           |
| `enter`        | Pick a piece up, or play the move         |
| `esc`          | Cancel the selection, then leave the game |
| `u`            | Take the last move back                   |
| `r`            | Start a new game                          |
| `f`            | Flip the board                            |

Selecting a piece dots the squares it may move to and highlights the pieces it
may capture. Promotions prompt for `Q`, `R`, `B`, or `N`.

On the other screens: `↑↓` browse, `←→` page the leaderboard, `s` cycles its
sort, and `r` refreshes. In the store, `enter` buys the highlighted title
(pressed twice, so a stray keypress can't spend your coins), equips one you
own, or unequips the one you're wearing.

## Progression

Finished server games pay XP and coins scaled by difficulty — wins pay most,
draws some, and losses a consolation of XP only. Games shorter than ten plies
pay nothing, so resign-farming is worthless. Payouts can unlock achievements,
which grant one-time XP and coin bonuses on top; coins buy titles in the store,
and the title you equip is shown next to your name on the leaderboard.

## API errors

Every response with an unsuccessful status is
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details, served as
`application/problem+json`:

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

`requestId` matches the `x-request-id` header and the server log line, so a
report from a client can be traced to what actually happened.

Validation failures add an `errors` array naming each offending field, and carry
`"type": "/problems/validation-error"`:

```json
{
  "type": "/problems/validation-error",
  "title": "Validation Failed",
  "status": 422,
  "detail": "The json does not match the expected schema",
  "instance": "/players",
  "errors": [
    {
      "path": "name",
      "message": "Too small: expected string to have >=3 characters",
      "code": "too_small"
    },
    {
      "path": "rating",
      "message": "Invalid input: expected number, received undefined",
      "code": "invalid_type"
    }
  ]
}
```

Unhandled server errors return a bare `500` in production. Outside production
they also include the error's `detail` and `stack`, which is convenient locally
and would leak internals if it ever shipped — so keep `NODE_ENV=production` set
in production.

## Development

```sh
bun test             # engine, screens, and API error handling
bun run typecheck
bun run db:seed      # reseed the catalogs after editing them
```

The chess engine is verified with [perft](https://www.chessprogramming.org/Perft)
against the standard positions, so move generation can be trusted before
anything is built on top of it.

## License

[MIT](LICENSE)
