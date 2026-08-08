# OpenChess

Chess, in your terminal.

[![CI](https://github.com/HilthonTT/OpenChess/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/HilthonTT/OpenChess/actions/workflows/ci.yml)
[![Bun](https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white)](https://bun.sh) [![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org) [![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://react.dev) [![OpenTUI](https://img.shields.io/badge/OpenTUI-terminal_UI-5A45FF)](https://github.com/sst/opentui) [![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white)](https://hono.dev) [![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io) [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org) [![Clerk](https://img.shields.io/badge/Clerk-6C47FF?logo=clerk&logoColor=white)](https://clerk.com) [![Polar](https://img.shields.io/badge/Polar-0062FF)](https://polar.sh) [![Sentry](https://img.shields.io/badge/Sentry-362D59?logo=sentry&logoColor=white)](https://sentry.io) [![Inngest](https://img.shields.io/badge/Inngest-000000)](https://www.inngest.com) [![Zod](https://img.shields.io/badge/Zod-3E67B1?logo=zod&logoColor=white)](https://zod.dev) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A TUI chess game with a full progression system behind it: play locally or
against the engine, earn XP and coins, unlock achievements, climb the
leaderboard, and spend your winnings on titles — all without leaving the
terminal.

## What's in it

| | |
| --- | --- |
| **Local 1v1** | Two players, one keyboard, no account |
| **Play vs AI** | Six named bots, each with its own taste in positions and opening repertoire. Server games pay XP and coins |
| **Online 1v1** | Matched from a queue, moves pushed over a live stream. The only games that move your Elo. Draw offers, and nine set phrases to say |
| **Challenges** | Play someone you picked, by name or short code, with a rematch when the game ends |
| **Friends** | Requests, presence (online / in a game / last seen), one key from a friend's row to a challenge |
| **Profiles** | Anyone's record, rating curve, title, achievements, recent games |
| **Puzzles** | A tactics trainer on its own Elo ladder: daily puzzle, solve streak, hints at half payout, training one motif at a time |
| **Puzzle Rush** | As many as you can solve before the clock or your third mistake, with a leaderboard per mode |
| **Watch** | Look in on any game in progress, on the same live stream |
| **Analysis** | Eval bar, accuracy per side, a verdict per ply, the opening as it gets named, jumps between mistakes, PGN in and out |
| **Openings** | An explorer over the book the engine plays from, searchable by name or ECO code |
| **Chess960** | The back rank shuffled, with castling that works from wherever the king and rooks landed |
| **Time controls** | Bullet, blitz and rapid on server AI and online games |
| **Progression** | Leaderboard, achievements, daily streaks, stats, and a store for titles you can wear |
| **Copy out** | `y` copies a FEN, `shift+y` a PGN — by asking the terminal, so it works over SSH |
| **A bell** | Rung when the queue pairs you or the opponent finally moves, the same way |
| **Go anywhere** | `ctrl+k` opens any screen by name; a screen that needs an account signs you in where you stand |
| **30+ themes** | The whole UI and board repaint from one picker |

All the rules are enforced: castling, en passant, promotion, checkmate,
stalemate, the fifty-move rule, threefold repetition, insufficient material —
and, online, draws by agreement.

## Layout

| Package | What it is |
| --- | --- |
| [`packages/cli`](packages/cli) | The game — an [OpenTUI](https://github.com/sst/opentui) React app |
| [`packages/server`](packages/server) | The HTTP API — [Hono](https://hono.dev) with OpenAPI docs |
| [`packages/database`](packages/database) | The [Prisma](https://www.prisma.io) schema and client, on PostgreSQL |
| [`packages/shared`](packages/shared) | The chess engine, the progression rules, the chat catalog |

## Setup

Needs [Bun](https://bun.sh) 1.3+ and a PostgreSQL database.

```sh
bun install
cp .env.example .env
```

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

The CLI reads its own three: `API_URL` (default `http://localhost:3000/api`),
`OPENCHESS_FPS` (default `60`), and `OPENCHESS_BELL` (`0`/`off`/`false`/`no`
turns the bell off for good).

### Database

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

## Running

```sh
bun run dev:cli      # the game
bun run dev:server   # the API, on http://localhost:3000
```

Interactive API docs at `/reference`, the raw OpenAPI document at `/doc`.

### Live games

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

## Playing

```sh
openchess                       # the menu
openchess puzzles               # straight to the tactics trainer
openchess profile hikaru        # somebody's record, by name
openchess --local --theme nord  # a screen may also be written as a flag
openchess --pgn game.pgn        # review a game from a file
openchess --fen 8/8/8/8/8/8/8/K6k w - - 0 1   # or a bare position
```

| Flag | What it does |
| --- | --- |
| `--theme <name>` | Any name from `--themes`, spelled however you like — `nord`, `tokyo-night`, `Rosé Pine`. This session only; it does not touch what the picker saved |
| `--fen <fen>` | Open Analysis on a position. Quotes optional — an unquoted FEN arrives as six arguments and is read back into one |
| `--pgn <file>` | Open Analysis on a game in a PGN file, without typing the path in |
| `--no-bell` | Don't ring the terminal for a match or a move |
| `--bell` | Ring it even where `OPENCHESS_BELL` turned it off |
| `--help` | Every screen; `--version` prints the version |

`--fen` and `--pgn` are the two ways into Analysis that need no account: the
position or the file is the whole of it, and the engine runs here. A FEN it
cannot read is refused on the command line rather than by clearing the terminal
to say so, so `openchess --fen "$(pbpaste)"` either opens a board or prints one
line.

In the workspace, arguments go after `--`: `bun run dev:cli -- puzzles --theme nord`.

Pick a screen with `↑↓` and `enter`, or press the number beside it — the first
nine carry one. **`ctrl + k` opens any screen by name**, from wherever you already
are. `ctrl + .` opens the theme picker, `ctrl + l` signs you in or out, `q` quits.

Online features need an account, and a screen that wants one says so and takes
`enter` to sign in on the spot. Reviewing a PGN file is the exception that needs
no account at all: the file is the whole game and the engine is local, so `i`
works signed out.

**`?` lists the keys of whatever screen you are on**, which is why what follows is
a summary rather than the manual. Each screen answers to a different set — `d` is a
draw offer at a board and a decline in the friends inbox — and the overlay
describes the reading that is *live*.

| Key | At the board |
| --- | --- |
| `↑↓←→`, `hjkl` | Move the cursor |
| `enter` | Pick a piece up, or play the move |
| `esc` | Cancel the selection, then leave the game |
| `u` / `r` / `f` | Take back / new game / flip |
| `y` | Copy the position as a FEN (`shift+y`: the game as a PGN) |
| `a` | Review the game, once it's over |

Selecting dots the squares a piece may move to and highlights what it may capture;
promotions prompt for `Q`, `R`, `B`, `N`. On a clocked game each side's time shows
above and below the board, and a fallen flag ends it.

| Screen | Its own keys |
| --- | --- |
| Online 1v1 | `d`/`n` draw and refusal (offering takes `d` twice), `x` twice resigns, `t` then `1`–`9` says a phrase, `c` claims a win from an opponent who left, `p` offers a rematch |
| Analysis | `←→` step, `home`/`end` jump to an end, `n`/`p` to the next and previous mistake, `e` writes a PGN to `~/openchess`, `i` reads one in, `y` copies the position you are *looking at* |
| Puzzles | `t` hint (names the square, halves the payout), `s` gives up, `n` next, `d` swaps the rated queue for the daily, `/` picks a motif to train |
| Puzzle Rush | `1`–`3` start a mode, `←→` browse first, `x` banks a run where it stands, `n` starts another. No hint and no solution during a run |
| Local 1v1 | `9` switches between the ordinary array and a shuffled one, dealing a fresh position |
| Openings | `↑↓` pick a continuation, `enter` plays it, `←` takes one back, `/` searches by name or ECO. Only book moves play |
| Challenges | `←→` inbox and sent, `enter` accepts, `d` declines, `x` withdraws, `n` writes one, `c` joins by code |
| Friends | `←→` friends, inbox, sent; `enter` opens a profile, `c` challenges, `x` twice removes, `a` searches by name |
| Profile | `f` asks or accepts, `d` declines, `x` twice unfriends, `c` challenges |
| Leaderboard | `↑↓` browse, `←→` page, `s` cycles the sort, `r` refreshes |
| Store | `enter` twice buys, equips, or unequips |

## Design notes

The parts of this where the obvious implementation is the wrong one — presence
without a connection, a chat that cannot be abused, castling on a shuffled back
rank, six bots out of one engine — are written up in **[DESIGN.md](DESIGN.md)**.

| | |
| --- | --- |
| [Asking the terminal](DESIGN.md#asking-the-terminal) | Clipboard and bell as escape sequences, so both work over SSH |
| [Friends, presence and chat](DESIGN.md#friends-presence-and-chat) | Presence derived from request timestamps; nine phrases and no free text |
| [Draws by agreement](DESIGN.md#draws-by-agreement) | One offer at a time, and the ten-ply floor that stops handshake farming |
| [Progression](DESIGN.md#progression) | Two Elo ladders, the rating curve, and what each payout is guarded by |
| [The bots](DESIGN.md#the-bots) | Four levers — weights, contempt, book style, blunder rate |
| [Chess960](DESIGN.md#chess960) | The three castling cases a normal array can never produce |
| [Puzzle Rush](DESIGN.md#puzzle-rush) | Server-timed, off the ladder, paid once at the end |
| [Puzzle themes](DESIGN.md#puzzle-themes) | Free-form tags, and the GIN index that makes them queryable |
| [The opening book](DESIGN.md#the-opening-book) | A transposition-aware trie, weighted by what runs through it |

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

## Development

```sh
bun test             # engine, screens, and API error handling
bun run typecheck
bun run lint         # Biome — formatting and lint in one pass
bun run lint:fix     # ...and fix what can be fixed automatically
bun run db:seed      # reseed the catalogs after editing them
```

The engine is verified with [perft](https://www.chessprogramming.org/Perft) against the
standard positions, so move generation can be trusted before anything is built on top
of it. Search is alpha-beta negamax over a material and piece-square evaluation, with a
[quiescence](https://www.chessprogramming.org/Quiescence_Search) search past the fixed
horizon — without which a depth-3 search that stops right after `RxN` counts the knight,
never sees the pawn recapture, and walks into losing trades believing they were winning
ones. The same search backs Analysis.

## Contributing

Bugs and small fixes can go straight to a pull request; anything that adds a screen or a
key is worth an issue first, since the keymap is crowded.
[CONTRIBUTING.md](CONTRIBUTING.md) covers the setup, the three checks CI runs, and the
conventions that are not obvious from the outside.

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md) — report privately, not in an issue

## License

[MIT](LICENSE)
