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

## What's in it

- **Local 1v1** — two players, one keyboard, no account
- **Play vs AI** — six named bots, each with its own taste in positions and its
  own opening repertoire; server games pay XP and coins
- **Online 1v1** — matched from a queue, moves pushed over a live stream. The
  only games that move your Elo. Draw offers, and nine set phrases to say
- **Challenges** — play someone you picked, by name or by a short code, with a
  rematch offered when the game ends
- **Friends** — requests, presence (online / in a game / last seen), and one key
  from a friend's row to a challenge
- **Profiles** — anyone's record, rating curve, title, achievements, recent games
- **Puzzles** — a tactics trainer on its own Elo ladder, with a daily puzzle, a
  solve streak, hints at half payout, and training one motif at a time
- **Puzzle Rush** — as many as you can solve before the clock or your third
  mistake, on a rising ramp, with a leaderboard per mode
- **Watch** — look in on any game in progress, on the same live stream
- **Analysis** — eval bar, accuracy per side, a verdict per ply, the opening as
  it gets named, jumps between mistakes, PGN in and out
- **Openings** — an explorer over the book the engine plays from, searchable by
  name or ECO code
- **Chess960** — the back rank shuffled, with castling that works from wherever
  the king and rooks landed
- **Time controls** — bullet, blitz and rapid on server AI and online games
- **Leaderboard**, **achievements**, **daily streaks**, **stats**, and a
  **store** for titles you can wear
- **Copy out** — `y` copies the position as a FEN, `shift+y` the game as a PGN,
  by asking the terminal, so it works over SSH
- **A bell** — the terminal is rung when the queue pairs you or the opponent
  finally moves, the same way
- **Go anywhere** — `ctrl+k` opens any screen by name from any other one, and a
  screen that needs an account signs you in where you stand
- **30+ themes** — the whole UI and board repaint from one picker

All the rules are enforced: castling, en passant, promotion, checkmate,
stalemate, the fifty-move rule, threefold repetition, insufficient material —
and, online, draws by agreement.

## Layout

| Package                                  | What it is                                                       |
| ---------------------------------------- | ---------------------------------------------------------------- |
| [`packages/cli`](packages/cli)           | The game — an [OpenTUI](https://github.com/sst/opentui) React app |
| [`packages/server`](packages/server)     | The HTTP API — [Hono](https://hono.dev) with OpenAPI docs         |
| [`packages/database`](packages/database) | The [Prisma](https://www.prisma.io) schema and client, on PostgreSQL |
| [`packages/shared`](packages/shared)     | The chess engine, the progression rules, the chat catalog        |

## Setup

Needs [Bun](https://bun.sh) 1.3+ and a PostgreSQL database.

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
in process, and reloads a game on each stream tick — slower, not broken.
**Set it before running more than one instance**: an in-process queue means one
queue per instance, and two players on different instances would wait forever
beside each other.

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

Run `db:migrate:status` after pulling: `db:generate` on its own leaves the
client expecting columns the database has not been told about, and every read of
that table then fails at once. The seed is idempotent — it upserts by `code`
(and `externalId` for puzzles), so rerunning it updates copy, rewards and prices
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
rather than a modelled response. It emits `state` events whose data is exactly
the body of `GET /api/games/{id}`: one on connect, one on every change. Same
auth as every other game route.

- **A settled game stays open for ninety seconds.** What people actually say in
  a chess game is said *after* it, and a stream that hung up on the final move
  would deliver every message except "good game". A game already over when the
  stream opens is the exception: one state event, then a hang-up.
- **Not every change is a move.** A draw offer and a message move neither the
  ply nor the result, so a client deciding "is this new?" from those two alone
  filters out both of the changes that are pure conversation. Compare
  `drawOfferFrom` and the last id in `chat` too — and treat them differently: a
  move is a new position and clears a held selection, a message is not and must
  not. Being told "nice move" should not put your piece back down.
- **`/watch/events` is the spectators' feed**, on the same loop and the same
  notifications. Its payload is the narrower `/watch` body — no legal moves,
  since there is nothing a watcher could act on, and no chat, since the two
  people playing did not sign up to be overheard.

A move made on the same instance is pushed the moment it commits; one made on
another instance is caught by a change counter in Redis that each stream
re-checks on a tick, since Upstash speaks REST and has no pub/sub. The
matchmaking queue stays polled on purpose: a poll *is* the "still here"
heartbeat the server pairs on.

## Playing

```sh
openchess                       # the menu
openchess puzzles               # straight to the tactics trainer
openchess profile hikaru        # somebody's record, by name
openchess --local --theme nord  # a screen may also be written as a flag
```

| Flag              | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `--theme <name>`  | Any name from `--themes`, spelled however you like — `nord`, `tokyo-night`, `Rosé Pine`. This session only; it does not touch what the picker saved |
| `--no-bell`       | Don't ring the terminal for a match or a move             |
| `--bell`          | Ring it even where `OPENCHESS_BELL` turned it off         |
| `--help`          | Every screen; `--version` prints the version              |

In the workspace, arguments go after `--`: `bun run dev:cli -- puzzles --theme nord`.

Pick a screen with `↑↓` and `enter`, or press the number beside it — the first
nine carry one. **`ctrl + k` opens any screen by name**, from wherever you
already are, which is how you reach the rest of them without going back to the
menu. `ctrl + .` opens the theme picker, `ctrl + l` signs you in or out, `q`
quits.

Online features need an account, and a screen that wants one says so and takes
`enter` to sign in on the spot — the browser opens, hands the token back, and
the screen fills in behind it. Reviewing a PGN file is the exception that needs
no account at all: the file is the whole game and the engine is local, so `i`
works signed out.

**`?` lists the keys of whatever screen you are on**, which is why what follows
is a summary rather than the manual. Each screen answers to a different set —
`d` is a draw offer at a board and a decline in the friends inbox — and the
overlay describes the reading that is *live*: with their draw offer on the board
it says `d` accepts and `n` declines; with yours standing, that `n` withdraws.

At the board:

| Key            | Action                                    |
| -------------- | ----------------------------------------- |
| `↑↓←→`, `hjkl` | Move the cursor                           |
| `enter`        | Pick a piece up, or play the move         |
| `esc`          | Cancel the selection, then leave the game |
| `u` / `r` / `f`| Take back / new game / flip               |
| `y`            | Copy the position as a FEN (`shift+y`: the game as a PGN) |
| `a`            | Review the game, once it's over           |

Selecting dots the squares a piece may move to and highlights what it may
capture; promotions prompt for `Q`, `R`, `B`, `N`. On a clocked game each side's
time shows above and below the board, and a fallen flag ends it.

| Screen        | Its own keys                                                    |
| ------------- | --------------------------------------------------------------- |
| Online 1v1    | `d`/`n` draw and refusal (offering takes `d` twice), `x` twice resigns, `t` then `1`–`9` says a phrase, `c` claims a win from an opponent who left, `p` offers a rematch |
| Analysis      | `←→` step, `home`/`end` jump to an end, `n`/`p` to the next and previous mistake, `e` writes a PGN to `~/openchess`, `i` reads one in, `y` copies the position you are *looking at* |
| Puzzles       | `t` hint (names the square, halves the payout), `s` gives up, `n` next, `d` swaps the rated queue for the daily, `/` picks a motif to train |
| Puzzle Rush   | `1`–`3` start a mode, `←→` browse first, `x` banks a run where it stands, `n` starts another. No hint and no solution during a run |
| Local 1v1     | `9` switches between the ordinary array and a shuffled one, dealing a fresh position                                  |
| Openings      | `↑↓` pick a continuation, `enter` plays it, `←` takes one back, `/` searches by name or ECO. Only book moves play     |
| Challenges    | `←→` inbox and sent, `enter` accepts, `d` declines, `x` withdraws, `n` writes one, `c` joins by code                  |
| Friends       | `←→` friends, inbox, sent; `enter` opens a profile, `c` challenges, `x` twice removes, `a` searches by name           |
| Profile       | `f` asks or accepts, `d` declines, `x` twice unfriends, `c` challenges                                                |
| Leaderboard   | `↑↓` browse, `←→` page, `s` cycles the sort, `r` refreshes                                                            |
| Store         | `enter` twice buys, equips, or unequips                                                                               |

## Design notes

### Asking the terminal

Both the clipboard and the bell are escape sequences written to stdout rather
than programs shelled out to, which is what makes them work over SSH: the
clipboard worth writing to and the person who should hear the bell are at the
near end, and everything this process could spawn is at the far end.

`y` copies a FEN and `shift+y` a PGN over
[OSC 52](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Operating-System-Commands),
on every board screen and in Analysis and Watch. tmux forwards it under its
default `set-clipboard external`. Nothing comes back from a terminal that was
asked, so "copied" means the sequence was written — what *can* be known is
checked first: redirected output is not a terminal and gets nothing written into
it, and a payload past 64 KiB is refused, since a terminal that truncates an OSC
string leaves the clipboard holding half a game and says nothing.

**A game the server is paying out on does not give up its position until it is
over.** `y` says so and copies nothing until the result is in. The offline
engine game and Local 1v1 have the same board and no such rule, which is where
to go to study a position mid-game. Watch is deliberately not held back — that
is somebody else's game, and the watcher has no move to be helped with.

The bell is `BEL` plus an [OSC 9](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Operating-System-Commands)
notification, which iTerm2, WezTerm, Ghostty, Konsole and Windows Terminal raise
on the desktop and everything else discards. What a terminal does with a bell is
the terminal's business, which is the right place for that decision. It rings
when the queue pairs you, when a draw is offered, when a game ends, and when the
opponent moves *after a think longer than twenty seconds* — a reply that came
back in four seconds means nobody wandered off, and one beep a move would make
bullet unplayable. Control characters are stripped from every message, because
opponents' names go in them and a name carrying its own `BEL` would otherwise be
a way to drive somebody else's terminal.

### Friends, presence and chat

**Presence is derived, never declared.** No "go online" call and no connection
held open: an authenticated request records that you were here, and the rest is
arithmetic on that timestamp. Online for five minutes after the last request,
`playing` if there is also an unfinished online game, offline otherwise — in
that order, since a game sits unfinished until someone resigns and a player who
walked away mid-game would otherwise read as "playing" forever. The write is
throttled to once a minute and never awaited, so the UI says "5m ago" rather
than pretending to seconds it does not have.

**A friendship is one row, and mutual requests resolve rather than pile up.**
Asking someone who has already asked you accepts their request — the order the
two landed in is not a reason to leave both pending, the same reading two
simultaneous draw offers get. Asking again while yours stands returns the one
already sent, and a decline answers one request rather than being a verdict.

**A profile is a strict subset of `/me`** — record, rating and curve, title,
achievements, recent games. No wallet, no ledger, no account identity, enforced
by projecting field by field, so a column added to `User` tomorrow is invisible
on a profile until somebody writes it down.

**Chat is nine phrases and no free text.** The wire carries a key like
`goodGame` and the receiving client looks up what it means, so nothing one
player controls ever reaches the other's screen. Safe by construction rather
than by filtering: no moderation queue, no mute list, no report flow, because
there is nothing to moderate. Capped per player per game, since nine phrases
cannot be abusive one at a time but a hundred in a row can. Players only —
spectators can watch but not talk, and the watch feed carries no chat at all.
Retiring a phrase is a copy edit, not a migration: stored messages keep their
key, and an unknown key renders as itself.

### Draws by agreement

Online games only. Agreeing takes two players and the bot is not one of them —
deciding when it says yes would be a strength setting dressed up as a rule.
Against the bot the position still draws itself the usual four ways.

One offer stands at a time. **The opponent's move declines it**, exactly as
playing on does over a board; **your own move does not**, since offering and
then moving is the ordinary habit; whatever ends the game clears it; and either
player may clear it outright — one request, because the game holds one offer.
Both offering at the same instant settles the game rather than deadlocking two
clients each waiting on the other.

An agreed draw is rated and paid like a drawn position — half a point, Elo
against the pre-game rating, XP but no coins — and held to the same ten-ply
floor as every result, which closes two accounts shaking hands at move one to
farm a `draws` column. Nothing legitimate is caught: stalemate, repetition and
insufficient material are all out of reach inside ten plies.

### Progression

Finished server games pay XP and coins scaled by difficulty — wins most, draws
some, losses a consolation of XP only. Under ten plies pays nothing, so
resign-farming is worthless. Payouts can unlock achievements, which grant
one-time bonuses; coins buy titles, and the equipped one shows on the
leaderboard.

**Puzzles run on their own Elo ladder**, kept apart from the game rating on
purpose: one number for both would let a player farm either side of it into a
rank they cannot hold. A solve pays by how far above your rating the puzzle sat,
capped at both ends; a failure pays nothing, since a puzzle can be failed
deliberately in one keystroke. Each puzzle scores once per player — the attempt
row is the idempotency key, so a retried submission cannot pay twice and a
solved puzzle can be replayed for practice. A hint halves both the payout and
the rating swing, and the server records that you took it rather than asking the
client to own up.

**Your rating is kept as a curve as well as a number.** Every settle that
actually moves it writes a point in the same transaction that banks the rating,
so the history can never disagree with the scalar the leaderboard sorts on. Only
real movement is recorded — an unrated bot game and a draw between equals both
move Elo by zero — which makes the series shorter than your game count on
purpose, and is why Stats calls it a trend rather than a game list. `peak` reads
over all of history, because a personal best that scrolled out of the last
twenty games is still the personal best.

**Signing in claims that day's streak.** Consecutive days pay more up to a cap
on the seventh, worth about half a won online game: a reason to come back, never
a substitute for playing. UTC days, a missed day restarts at one, and the claim
is idempotent. Streaks of 3, 7 and 30 unlock achievements.

### The bots

A difficulty slider answers "how hard is this to beat" and nothing else, so
three of them is three of the same opponent at three speeds. What makes a bot
worth playing twice is that it *wants* something.

| Bot       | ~Elo | Plays                                                                |
| --------- | ---- | -------------------------------------------------------------------- |
| Rookie    |  400 | At random, throughout                                                |
| Gambiteer | 1100 | Gives up pawns for the initiative, and means it                      |
| Fortress  | 1150 | Trades the fireworks for a structure you cannot break                |
| Grinder   | 1600 | Swaps down, pushes a pawn, and will not agree to anything            |
| Tactician | 1650 | Hunts for the tactic, and keeps the position sharp enough to have one |
| Maestro   | 1750 | No preferences. The engine as it comes                               |

Four levers, and none of them is a different engine:

- **Evaluation weights** — multipliers on material, piece-square tables, pawn
  structure, passed pawns, the bishop pair, rook files, the king's shield. The
  Gambiteer discounts material to 0.82 and pays 1.3 for activity, which is
  enough that a pawn for two developing moves reads as a good trade without
  anyone writing down what a gambit is; the Fortress does the reverse and
  weights its king shield at 1.9. Only *ratios* matter, which is what makes them
  tunable one at a time.
- **Contempt** — what a draw is worth in centipawns. The Grinder's is +45, so it
  plays on in level rook endings; the Fortress's is −20. Applied by whose turn it
  is rather than by ply count, so a position always gets the same draw score —
  which keeps contempt out of the transposition table's hair.
- **The book** — lines carry an optional `style` (`gambit`, `sharp`, `solid`,
  `classical`), credited to every move along a line rather than to its last, so a
  bot asked for gambits is pulled towards `f4` from move one rather than once it
  is already in the King's Gambit. A bias, not a filter.
- **Going wrong** — the weaker bots play a random legal move some of the time
  (6% Gambiteer, 5% Fortress, never the top three). Going wrong occasionally and
  badly is much closer to how a weaker player actually loses than playing every
  move slightly less well. The Rookie slips on every move, which is what makes it
  play at random without needing a case of its own.

A personality is a style *and* a strength, and the strength still maps onto the
three tiers, because rewards and rating scale by tier: beating a hard bot is
worth the same whichever hard bot it was. Games store both, so retuning a bot
cannot silently reprice every game played against it.

### Chess960

The back rank is shuffled; the pawns, the rules and where castling *ends* are
not. Arrays are numbered 0–959 by Scharnagl's scheme, and #518 being the
ordinary game is what lets one code path serve both variants.

Castling is the whole of what changes, and it is the one rule that cares where a
piece *started* — once the king has moved, "which rook was the h-rook" is no
longer readable off the squares. So a position carries the files its king and
rooks began on. Three cases a normal array can never produce are what a naive
implementation gets wrong, and all 960 are tested: a king that castles **without
moving at all**, a rook that lands on the square the king just left, and a king
that travels *left* to castle king-side. All three make the four squares overlap,
so both pieces are lifted before either is put down.

Castling is written **king-takes-rook** (`g1h1`) in a shuffled game and `e1g1`
in an ordinary one — not stylistic: on a shuffled array `b1c1` is both "king
steps right" and "castles queenside", so naming it by the king's destination
would make one move description mean two moves. FENs write `KQkq` when it can
only mean one thing and name the rooks' files (`HAha`, Shredder-FEN) when it
cannot, so every existing FEN round-trips byte for byte. Exported PGN carries
`[Variant "Chess960"]`, without which a reader has no reason to expect `O-O` to
move a king that is not on e1.

The array is dealt server-side and stored as `startFen`: a shuffled game that
only stored its moves would replay onto the standard array and be a different
game every time it was read. Challenges deal it on *acceptance*, so one that sat
in an inbox overnight cannot have been studied by the sender.

### Puzzle Rush

Three minutes, five minutes, or survival — no clock, just the three mistakes.
Same protocol as the tactics trainer, with three deliberate differences.

It is **server-timed**: `endsAt` is written when the run starts and every
submission is checked against it, because a score a client's own timer could
vouch for is not a score. It is **off the ladder** — no attempt row, no rating
movement — since rushing rewards speed and rating rewards accuracy, and a run
should never eat into the pool of puzzles you have not been scored on. And it
pays **once, at the end**, guarded by the run's own `rewardsGranted` flag: per
solve would make a run a coin faucet you tap by abandoning it at nine. The rate
is under the rated queue's, with a bonus at 10, 20 and 30. The ramp is linear —
35 points a solve from 600, levelling off at 2600 — because a ramp that got hard
quickly would make the whole score depend on the first thirty seconds.

### Puzzle themes

Stored puzzles carry free-form theme tags, because the corpus decides what it
tags. `chess/puzzle-themes.ts` is the display side: the ones worth naming and
which a player would sensibly train. An unknown theme still filters and still
shows, under an un-camel-cased version of its raw key, because silently dropping
them would make a freshly imported corpus look half-empty. Not everything is
worth training — `fork` and `backRankMate` name something to practise,
`middlegame` and `crushing` describe a puzzle; both show, only the first is
offered as a filter.

Filtering is `themes @> ARRAY['fork']`, which a b-tree cannot answer, so the
column carries a GIN index — without it, serving a themed puzzle is a sequential
scan of the whole corpus. The per-theme record is a grouped `unnest` over your
attempts; the corpus-wide counts are the same shape over every puzzle, which is
expensive and therefore cached for an hour, since it only changes on an import.

### The opening book

Before the search runs, the engine looks the position up. About a hundred named
lines in `chess/opening-lines.ts` are folded into a trie of one node per
position, and every line is replayed through the engine by its test, so an
authoring slip cannot ship as a bot with no move to make.

Positions are keyed the way threefold repetition keys them, which makes the book
transposition-aware without being asked: `1.e4 e5 2.Nf3 Nc6 3.Bc4` and
`1.e4 e5 2.Bc4 Nc6 3.Nf3` are one key, so both are the Italian. Keying on the
move list would have made them two openings — obvious on a board, invisible in a
trie.

The choice among continuations is weighted rather than always-the-mainline, and
a line's weight is added to every move along it, so a branch's pull is the sum of
what runs through it: a first move twenty lines deep outranks one played by two
without either needing a weight by hand. That also makes the explorer's
percentages a reading of *this book*, not of a database of master games. `easy`
skips the book along with the search — a beginner's opponent that opens with ten
plies of the Najdorf and then hangs its queen is a worse teacher than one that is
bad throughout.

Naming runs the other way out of the same trie. A game is called after the
deepest opening it passed through, not its current position, because a game
leaves the book long before it stops being a Sicilian. That is what Analysis
shows as you step and what `[ECO]` and `[Opening]` carry into an exported PGN —
written only when the book recognises the game, since `[Opening "?"]` claims the
opening is unknown rather than unasked.

## API errors

Every unsuccessful response is [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)
problem details, served as `application/problem+json`:

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

Validation failures carry `"type": "/problems/validation-error"`, a `422`, and an
`errors` array naming each offending field:

```json
"errors": [
  { "path": "name", "message": "Too small: expected string to have >=3 characters", "code": "too_small" }
]
```

Unhandled errors return a bare `500` in production. Outside production they also
include `detail` and `stack` — convenient locally, a leak if it ever shipped, so
keep `NODE_ENV=production` set in production.

## Development

```sh
bun test             # engine, screens, and API error handling
bun run typecheck
bun run db:seed      # reseed the catalogs after editing them
```

The engine is verified with [perft](https://www.chessprogramming.org/Perft)
against the standard positions, so move generation can be trusted before
anything is built on top of it. Search is alpha-beta negamax over a material and
piece-square evaluation, with a
[quiescence](https://www.chessprogramming.org/Quiescence_Search) search past the
fixed horizon — without which a depth-3 search that stops right after `RxN`
counts the knight, never sees the pawn recapture, and walks into losing trades
believing they were winning ones. The same search backs Analysis.

## License

[MIT](LICENSE)
