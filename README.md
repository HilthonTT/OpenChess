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
- **Play vs AI** — six named opponents, each with its own taste in positions and
  its own opening repertoire, from a Rookie that plays at random to a Maestro
  that does not; server games pay out XP and coins
- **Chess960** — the back rank shuffled, against the engine or a friend, with
  castling that works from wherever the king and rooks happened to land
- **Online 1v1** — matched against the next player in the queue, with the
  opponent's moves pushed over a live stream; the only games that move your Elo
  rating, and they pay the biggest rewards. Offer a draw and they can take it,
  decline it, or answer with a move
- **Challenges** — play someone you picked instead of whoever is next: by name,
  or by a short code anyone can take. A finished game offers a rematch, same
  clock and colours swapped
- **Puzzles** — a tactics trainer on its own Elo ladder, with a daily puzzle
  everyone gets, a solve streak, and hints that cost you half the payout. Train
  one motif at a time — forks, back-rank mates, zugzwang — and see your record
  at each
- **Puzzle Rush** — as many as you can solve before the clock or your third
  mistake stops you, on a ramp that gets harder as you go, with a leaderboard
  per mode
- **Watch** — look in on any game being played right now, fed by the same live
  stream the players are on
- **Time controls** — bullet, blitz and rapid clocks on server AI and online
  games; run out and you lose on time (the bot itself is never clocked)
- **Analysis** — step through any finished game with the engine: an eval bar,
  an accuracy score per side, a move-quality verdict per ply, the opening as it
  gets named, and the move it would have played. Jump between the mistakes,
  export the game as PGN, or import someone else's
- **Openings** — an explorer over the same book the engine plays from: what
  theory does from here, how much of the book goes each way, and what each
  continuation is called. Search it by name or ECO code
- **Leaderboard** — ranked by rating, level or wins
- **Achievements** — one-time XP/coin bonuses, some of them secret
- **Daily streaks** — check in each day for a growing XP and coin payout
- **Stats** — your record, streaks, level progress, your best Puzzle Rush score
  at each mode, and your rating as a curve rather than a number: where it has
  been over your recent rated games, and the best it has ever been
- **Store** — buy titles with coins and wear one on the leaderboard
- **30+ themes** — the whole UI and board repaint from one picker

All the chess rules are enforced: castling, en passant, promotion, checkmate,
stalemate, the fifty-move rule, threefold repetition, and insufficient material.
Online games can also be drawn the way most games between humans actually end —
by agreement.

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
| `UPSTASH_REDIS_REST_URL`    | see note | —             | Read cache, matchmaking queue, live-game change counter  |
| `UPSTASH_REDIS_REST_TOKEN`  | see note | —             | Must be set together with the URL, or neither            |

Without the Upstash pair the server runs uncached, keeps the matchmaking queue
in process, and falls back to reloading a game on each stream tick — slower and
single-instance, not broken. **Set it before running more than one instance**:
an in-process queue means one queue per instance, and two players on different
instances would wait forever beside each other.

The CLI additionally reads `API_URL` (defaults to `http://localhost:3000/api`)
and `OPENCHESS_FPS` (defaults to `60`).

### Database

```sh
bun run db:generate            # generate the Prisma client
bun run db:migrate             # create and apply a migration (development)
bun run db:seed                # seed the achievement, title and puzzle catalogs
```

The migration scripts are the ones worth knowing, since a schema change that
reaches the client but not the database makes every read of the affected table
fail at once:

| Script                  | What it does                                             |
| ----------------------- | -------------------------------------------------------- |
| `db:generate`           | Regenerate the Prisma client from the schema             |
| `db:migrate`            | Create and apply a migration — development, interactive  |
| `db:migrate:deploy`     | Apply pending migrations without generating one — production |
| `db:migrate:status`     | What is applied and what is pending                      |

Run `db:migrate:status` after pulling: `bun run db:generate` on its own leaves
the client expecting columns the database has not been told about yet.

The seed is idempotent — it upserts by `code` (and by `externalId` for puzzles),
so rerunning it updates copy, rewards and prices in place without touching
anything players have earned.

The built-in puzzle catalog is a starter set of a dozen hand-authored positions,
each one checked against the engine by `puzzle-catalog.test.ts` — an authoring
slip would otherwise reach players as a puzzle they cannot solve. For a real
corpus, import the [Lichess puzzle database](https://database.lichess.org/#puzzles),
which is CC0 and already in the format this speaks:

```sh
curl -O https://database.lichess.org/lichess_db_puzzle.csv.zst
zstd -d lichess_db_puzzle.csv.zst
bun run db:import-puzzles lichess_db_puzzle.csv --limit 20000
```

Every row is replayed through the engine before it is written, and one that will
not replay is counted and skipped rather than failing the import. Rows are
upserted by `externalId`, so a rerun against a newer dump refreshes ratings in
place and leaves players' attempts attached. `--min-rating` and `--max-rating`
narrow the band; the default is 400–2400.

## Running

```sh
bun run dev:cli      # the game
bun run dev:server   # the API, on http://localhost:3000
```

Interactive API docs are served at `/reference`, and the raw OpenAPI document at
`/doc`.

### Live games

`GET /api/games/{id}/events` is a
[Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
stream — the one route not in the OpenAPI document, because its body is a stream
rather than a modelled response. It emits `state` events whose data is exactly
the JSON body of `GET /api/games/{id}`: one immediately on connect, one on every
change, and then the server hangs up once the game is settled. It sits behind the
same auth as every other game route and refuses a game you are not playing in.

Not every change is a move. A draw offer moves neither the ply nor the result, so
a client that decides "is this new?" by comparing those two alone will filter the
one board change that is pure negotiation straight out — compare `drawOfferFrom`
as well, as both CLI screens do.

`GET /api/games/{id}/watch/events` is the spectators' feed, on the same loop and
the same notifications, so a watcher is never a tick behind the players. Its
payload is the narrower `GET /api/games/{id}/watch` body: both players, the
position, the clocks and the move list, and no legal moves at all — there is
nothing in it a watcher could act on.

That is how the opponent's moves reach the CLI. They used to arrive by polling
every two seconds, each poll paying for a token verification and a full game
load; now a move made on the same instance is pushed the moment it commits. A
move made on *another* instance is caught by a change counter in Redis that each
stream re-checks on a tick — Upstash speaks REST, which has no pub/sub, so the
polling did not vanish so much as move off the client and onto a counter that is
cheap to read.

The matchmaking queue is polled, and stays that way: a poll *is* the "still here"
heartbeat the server pairs on, so there is nothing to push that the next poll
would not already ask for.

## Playing

Pick a screen from the menu with `↑↓` and `enter`, or press the number beside
it. `ctrl + .` opens the theme picker, `ctrl + l` signs you in or out, and `q`
quits. Online features (puzzles, challenges, watching, leaderboard,
achievements, stats, store) need an account; sign-in opens your browser and
hands the token back to the CLI. Reviewing a PGN file is the one exception — the
file is the whole game and the engine runs locally, so it works signed out.

At the board:

| Key            | Action                                    |
| -------------- | ----------------------------------------- |
| `↑↓←→`, `hjkl` | Move the cursor                           |
| `enter`        | Pick a piece up, or play the move         |
| `esc`          | Cancel the selection, then leave the game |
| `u`            | Take the last move back                   |
| `r`            | Start a new game                          |
| `f`            | Flip the board                            |
| `a`            | Review the game (once it's over)          |

Selecting a piece dots the squares it may move to and highlights the pieces it
may capture. Promotions prompt for `Q`, `R`, `B`, or `N`.

On a clocked game each side's remaining time shows above and below the board,
counting down for whoever is to move; a fallen flag ends the game on time.

In an **online** game `d` is the draw key and `n` is the refusal. With no offer
on the board, `d` twice offers one (twice, like `x`, so half a game is not given
away by a stray keypress); while your own offer stands, `n` withdraws it; and
when the offer is your opponent's, `d` accepts and `n` declines. The footer and
the status line say which of those the keys currently mean, and an offer reaches
the other player over the same live stream their moves do.

In the **Analysis** screen — reached from the menu or with `a` from a finished
game — `←→` step through the moves, `home`/`end` jump to either end, and `f`
flips the board. `n` and `p` jump to the next and previous mistake, which is the
fast way through a long game. The eval bar, the accuracy line and the per-move
verdict fill in as the engine works back through the game. `e` writes the game
out as PGN (to `~/openchess`), and `i` from the game list reads one back in —
including a game played somewhere else entirely.

In **Puzzles**, play the move you think the position wants: `enter` picks a
piece up and plays it, `t` asks for a hint (which names the square the piece
stands on, and halves what the solve is worth), `s` gives up and plays the
answer out, `n` fetches the next puzzle, and `d` switches between the rated
queue and the daily puzzle. `/` opens the theme picker, which lists every motif
the corpus has, how many puzzles carry it, and how many of those you have
solved — so "which am I bad at" is answerable rather than guessed at. Picking
one narrows the queue to that motif without leaving the rating band, so
training a theme cannot quietly hand you puzzles far above your level.

In **Puzzle Rush**, `1`–`3` start a run at the mode you want and `←→` browse the
boards without committing to one. During a run the keys are the puzzle screen's,
minus the ones that would be cheating: no hint, no solution. `x` stops a run
where it stands and banks the score; `n` starts another once it is over. The
clock is the server's — the countdown is drawn from when the run actually ends,
not counted down locally, so a paused terminal buys nobody a longer run.

In **Local 1v1**, `9` switches between the ordinary array and a shuffled one,
dealing a fresh position as it goes. `r` then starts a new game in whichever of
the two you are playing — a shuffled game that replayed its own array would only
ever be one shuffled game.

In **Openings** — the explorer, reached from the menu — `↑↓` pick a
continuation and `enter` plays it, `←` takes one back, `r` starts again, and
`f` flips the board. `/` searches the book by name or ECO code and jumps
straight to the line. Only book moves can be played, so there is no wandering
off: a line either continues or ends, and the screen says which. It needs no
account, since the book is compiled into the client.

In **Challenges**, `←→` switch between what is waiting for you and what you
sent, `enter` accepts, `d` declines, `x` withdraws one of yours, `n` writes a
new one, and `c` joins by code. In **Watch**, `enter` opens the highlighted
game and `f` flips the board.

On the other screens: `↑↓` browse, `←→` page the leaderboard, `s` cycles its
sort, and `r` refreshes. In the store, `enter` buys the highlighted title
(pressed twice, so a stray keypress can't spend your coins), equips one you
own, or unequips the one you're wearing.

## Draws by agreement

Online games only. Agreeing a draw takes two players, and the bot is not one of
them — asking it to accept would need a policy for when it says yes, which is a
strength setting dressed up as a rule. Against the bot the position still draws
itself by stalemate, repetition, the fifty-move rule or insufficient material.

One offer stands at a time, and what clears it is the part worth stating:

- **The opponent's move declines it.** Playing on instead of accepting is the
  answer, exactly as it is over a board.
- **Your own move does not.** Offering and then moving is the ordinary habit, and
  an offer that withdrew itself a moment later would be useless.
- **Whatever ends the game clears it**, so a settled game never carries one.
- Either player may clear it outright: the offerer withdraws, the opponent
  declines. It is one request, because the game holds one offer.

Both players offering at the same instant settles the game rather than
deadlocking two clients each waiting on the other — two players who both asked
for a draw have agreed, whatever order the requests landed in.

An agreed draw is rated and paid exactly like a drawn position: half a point
each, Elo against the opponent's pre-game rating, XP but no coins. It is also
held to the same ten-ply floor as every other result, which closes win-trading's
cousin — two accounts queueing and shaking hands at move one to farm a `draws`
column apiece. Nothing legitimate is caught by that floor: stalemate, repetition
and insufficient material are all out of reach inside ten plies, so a draw that
early can only have been agreed.

## Progression

Finished server games pay XP and coins scaled by difficulty — wins pay most,
draws some, and losses a consolation of XP only. Games shorter than ten plies
pay nothing, so resign-farming is worthless. Payouts can unlock achievements,
which grant one-time XP and coin bonuses on top; coins buy titles in the store,
and the title you equip is shown next to your name on the leaderboard.

**Puzzles** run on their own Elo ladder, kept apart from the game rating on
purpose: solving tactics and winning games are different skills, and one number
for both would let a player farm either side of it into a rank they cannot hold.
A solve pays XP and coins scaled by how far above your own rating the puzzle sat
— capped at both ends — and a failure pays nothing at all, because a puzzle can
be failed deliberately in one keystroke. Each puzzle is scored once per player:
the attempt row is the idempotency key, so a retried submission cannot pay
twice and a solved puzzle can be replayed for practice without moving anything.
Taking the hint halves both the payout and the rating swing, and the server
records that you took it rather than asking the client to own up.

Your **rating** is kept as a curve as well as a number. Every settle that
actually moves it writes a point — the new rating and the change that produced
it — in the same transaction that banks the rating itself, so the history can
never disagree with the scalar the leaderboard sorts on. Only real movement is
recorded: an unrated game against the bot and a draw between equals both move
Elo by exactly zero, and a point for either would report a game rather than a
change. That makes the series shorter than your game count on purpose, which is
why the Stats screen labels it a trend and not a game list. `peak` is read over
all of history rather than the window, because a personal best that scrolled out
of the last twenty games is still the personal best.

**Puzzle Rush** pays separately and by a different rule — see below. It moves no
rating at all, so a run can never touch the ladder in either direction.

Signing in also claims that day's **streak**. Consecutive days pay more, up to a
cap on the seventh — worth about half a won online game, so showing up is a
reason to come back and never a substitute for playing. Days are UTC calendar
days as the server counts them, a missed day restarts the run at one, and the
claim is idempotent: launching the game five times in a day pays once. Streaks
of 3, 7 and 30 days unlock achievements of their own.

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

Search is alpha-beta negamax over a material and piece-square evaluation, with a
[quiescence](https://www.chessprogramming.org/Quiescence_Search) search past the
fixed horizon. That last part is what stops the engine trusting a score taken
mid-exchange: without it a depth-3 search that stops right after `RxN` counts the
knight and never sees the pawn recapture, so it walks into losing trades and
believes they were winning ones. The same search backs the Analysis screen.

## The bots

A difficulty slider answers "how hard is this to beat" and nothing else, so
three of them is three of the same opponent at three speeds. What makes a bot
worth playing twice is that it *wants* something — and the engine already had
every lever needed to give it one.

| Bot         | ~Elo | Plays                                                    |
| ----------- | ---- | -------------------------------------------------------- |
| Rookie      |  400 | At random, throughout                                    |
| Gambiteer   | 1100 | Gives up pawns for the initiative, and means it          |
| Fortress    | 1150 | Trades the fireworks for a structure you cannot break    |
| Grinder     | 1600 | Swaps down, pushes a pawn, and will not agree to anything |
| Tactician   | 1650 | Hunts for the tactic, and keeps the position sharp enough to have one |
| Maestro     | 1750 | No preferences. The engine as it comes                   |

Four things separate them, and none of them is a different engine.

**What the evaluation cares about.** `evaluate` takes a set of weights —
multipliers on material, the piece-square tables, pawn structure, passed pawns,
the bishop pair, rook files and the king's pawn shield. The Gambiteer discounts
material to 0.82 and pays 1.3 for activity, which is enough that a pawn for two
developing moves reads as a good trade without anyone writing down what a gambit
is. The Fortress does the reverse and weights its king shield at 1.9. Only
*ratios* matter: scaling every weight together scales the score and changes no
decision, which is the property that makes them tunable one at a time.

**Contempt.** What a draw is worth, in centipawns, to the side the search is
running for. The Grinder's is +45, so it plays on in level rook endings most
engines would shake hands in; the Fortress's is −20, so it takes the half point.
It is applied by whose turn it is rather than by ply count — the same thing,
said in a way that makes it obvious a given position always gets the same draw
score, which is what keeps contempt out of the transposition table's hair.

**The book.** Lines in `opening-lines.ts` carry an optional `style` — `gambit`,
`sharp`, `solid`, `classical` — and, like `weight`, it is credited to every move
along a line rather than to its last. So a bot asked for gambits is pulled
towards `f4` from the very first move rather than only once it is already in the
King's Gambit. The pull is a bias, not a filter: a bot with a taste still has an
answer to every position.

**Going wrong.** The weaker bots play a random legal move some of the time — 6%
for the Gambiteer, 5% for the Fortress, never for the top three. It is the blunt
weakening and the honest one: a bot meant to be beatable has to actually go
wrong somewhere, and going wrong occasionally and badly is much closer to how a
weaker player loses than playing every move slightly less well would be. The
Rookie slips on every move, which is what makes it play at random without
needing a case of its own.

A personality is a style *and* a strength, and the strength still maps onto the
three tiers, because that is what rewards and rating are scaled by: beating a
hard bot is worth the same whichever hard bot it was. Games store both, so
retuning a bot cannot silently reprice every game anyone has played against it.

## Chess960

The pieces on the back rank are shuffled; the pawns, the rules, and where
castling *ends* are not. Arrays are numbered 0–959 by Scharnagl's scheme, the
one every engine and database uses — #518 is the ordinary game, which is worth
more than trivia: it is what lets one code path serve both variants, and the
test pins it down to the FEN.

Castling is the whole of what changes, and it is the one rule that cares where a
piece *started* — by the time the king has moved once, "which rook was the
h-rook" is no longer readable off the squares. So a position carries the files
its king and rooks began on, per colour, and castling reads those instead of
assuming e1/a1/h1. The king still finishes on the g- or c-file and the rook
beside it, whatever they started on, which is what makes a shuffled game's
castling recognisably the same move.

Three cases a normal array can never produce are what a naive implementation
gets wrong, and all 960 of them are tested: a king that castles **without
moving at all** (it was already on g1), a rook that lands on the square the king
just left, and a king that travels *left* to castle king-side. All three make
the four squares involved overlap, so both pieces are lifted before either is
put down — placing one first would quietly delete the other.

Castling is written **king-takes-rook** (`g1h1`) in a shuffled game, and
`e1g1` in an ordinary one. That is not stylistic: on a shuffled array the king's
castling destination is frequently a square it could also reach as an ordinary
king move — `b1c1` is both "king steps right" and "castles queenside" — so
naming it would make one move description mean two moves. The rook's square
never collides, because it holds the mover's own rook.

FENs write `KQkq` whenever it can only mean one thing and name the rooks' files
outright (`HAha`, Shredder-FEN) when it cannot, so every existing FEN in the
project round-trips byte for byte. Exported PGN carries `[Variant "Chess960"]`
alongside `SetUp` and `FEN`; without it a reader has a legal-looking position and
no reason to expect `O-O` to move a king that is not on e1.

The array is dealt server-side and stored on the game. A shuffled game that only
stored its moves would replay onto the standard array and be a different game
every time it was read — so `startFen` is not decoration, it is what makes the
move list mean anything. Challenges deal it on *acceptance* rather than when
sent, so a challenge that sat in an inbox overnight cannot have been studied by
the player who sent it.

## Puzzle Rush

As many puzzles as you can solve before the clock or your third mistake stops
you, over three minutes, five minutes, or survival — which has no clock and only
the three mistakes.

It is the same protocol the tactics trainer uses, with three deliberate
differences.

The run is **server-timed**. `endsAt` is written when it starts and every
submission is checked against it, because a score a client's own timer could
vouch for is not a score.

It is **off the ladder**. A run writes no attempt row and moves no puzzle
rating: rushing rewards speed and nerve, rating rewards accuracy, and a player
should be able to do one without wrecking the other. It also means a rush never
eats into the pool of puzzles you have not been scored on — you can rush the
same positions all week and still meet them fresh when they count.

And it pays **once, at the end**, guarded by the run's own `rewardsGranted` flag
exactly as a game is. Paying per solve would make a run a coin faucet you could
tap by starting one and abandoning it at nine. The rate is deliberately under
the rated queue's, since a rush serves puzzles you may already have solved,
with a bonus at 10, 20 and 30 so a good run is worth pushing for rather than
being worth exactly one more puzzle than a mediocre one.

The ramp is linear — the target rating climbs 35 points per solve from 600, and
levels off at 2600 where the corpus thins out. A ramp that got hard quickly
would make the whole score depend on the first thirty seconds.

## Puzzle themes

Stored puzzles carry free-form theme tags, because they arrive with whichever
corpus was imported and the corpus decides what it tags. `chess/puzzle-themes.ts`
is the display side of that: the ones worth naming, what to call them, and which
a player would sensibly ask to train. A theme the catalog has never heard of
still filters and still shows — under an un-camel-cased version of its raw key —
because a catalog that silently dropped unknown themes would make a freshly
imported corpus look half-empty.

Not everything is worth training. `fork` and `backRankMate` name something to
practise; `middlegame` and `crushing` describe a puzzle. Both are shown, only
the first kind is offered as a filter.

Filtering is `themes @> ARRAY['fork']`, which a b-tree cannot answer at all, so
the column carries a GIN index. Without it, serving a themed puzzle is a
sequential scan of the whole corpus — fine over the seeded dozen, and not over
an imported two hundred thousand. The per-theme record is a grouped `unnest`
over your own attempts; the corpus-wide counts are the same shape over every
puzzle, which is genuinely expensive and therefore cached for an hour, since it
only changes when someone runs an import.

## The opening book

Before the search runs at all, the engine looks the position up. The book is a
starter set of about a hundred named lines in `chess/opening-lines.ts` — the
openings a club player actually meets, written as the move list that reaches
them — which `chess/opening-book.ts` folds into a trie of one node per position.
Every line is replayed through the engine by its test, so an authoring slip
cannot ship as a bot with no move to make.

Positions are keyed the way threefold repetition keys them, which makes the book
transposition-aware without being asked: `1.e4 e5 2.Nf3 Nc6 3.Bc4` and
`1.e4 e5 2.Bc4 Nc6 3.Nf3` are one key, so both are the Italian and both offer
the Italian's continuations. Keying on the move list would have made them two
different openings — obvious on a board, invisible in a trie.

The choice among continuations is weighted rather than always-the-mainline, so
the bot does not play out the same eight moves every game. A line's weight is
added to every move along it rather than to its last, which means a branch's
pull is the sum of what runs through it: a first move twenty lines deep outranks
one played by two without either needing a weight set by hand. The explicit
weights in the file are only for the top of the tree, where the number of lines
below a move is a fact about how much theory got written down rather than about
how often it is played. That also makes the percentages the explorer shows a
reading of *this book*, not of a database of master games.

`easy` skips the book along with the search. It plays at random, which is the
point of it — a beginner's opponent that opens with ten plies of the Najdorf and
then hangs its queen is a worse teacher than one that is bad throughout.

Naming runs the other way out of the same trie. A game is called after the
deepest opening it passed through, not after its current position, because a
game leaves the book long before it stops being a Sicilian. That name is what
the Analysis screen shows as you step, and what `[ECO]` and `[Opening]` carry
into an exported PGN — written only when the book recognises the game, since an
`[Opening "?"]` claims the opening is unknown rather than unasked.

## License

[MIT](LICENSE)
