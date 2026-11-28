<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-wordmark-dark.svg">
    <img src="assets/logo-wordmark-light.svg" alt="OpenChess" width="420">
  </picture>
</h1>

<p align="center">Chess, in your terminal.</p>

<p align="center">
  <a href="https://github.com/HilthonTT/OpenChess/actions/workflows/ci.yml"><img src="https://github.com/HilthonTT/OpenChess/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white" alt="Bun"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://github.com/sst/opentui"><img src="https://img.shields.io/badge/OpenTUI-terminal_UI-5A45FF" alt="OpenTUI"></a>
  <a href="https://hono.dev"><img src="https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white" alt="Hono"></a>
  <a href="https://www.prisma.io"><img src="https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white" alt="Prisma"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <img src="assets/demo/local.gif" alt="A game of Local 1v1 in the terminal, ending in Scholar's mate" width="760">
</p>

A TUI chess game with a full progression system behind it: play locally, against
six engine personalities, or online; train tactics and openings; review games with
an engine; earn XP, coins, achievements and titles — without leaving the terminal.

**[Play in the browser →](https://hilthontt.github.io/OpenChess/)** A static build
of the same engine (pass and play or any of the bots, with clocks and Chess960),
running in a Web Worker with no backend.

## Demo

| Review a game with the engine | 30+ themes |
| --- | --- |
| <img src="assets/demo/analysis.gif" alt="Stepping through Morphy's Opera Game in Analysis, with eval bar and move verdicts"> | <img src="assets/demo/themes.gif" alt="The same position under several themes"> |
| **The menu** | **Opening explorer** |
| <img src="assets/demo/menu.gif" alt="The main menu"> | <img src="assets/demo/explorer.png" alt="The opening explorer after 1. e4 e5 2. Nf3"> |
| **The web app** | **Six bots, clocks, Chess960** |
| <img src="assets/demo/web.gif" alt="A game against the Fortress bot in the browser"> | <img src="assets/demo/web-new-game.png" alt="The web app's new-game dialog"> |

## Features

- **Play** — local 1v1, six bots with their own style and opening book, or ranked
  online games from a matchmaking queue, with premoves, draw offers, takebacks and
  bullet/blitz/rapid clocks. Chess960 throughout.
- **Social** — challenges by name or code, friends with presence, profiles with a
  rating curve, spectating with a gallery chat, nine set phrases instead of free text.
- **Train** — a puzzle ladder with its own Elo, daily puzzle, Puzzle Rush, motif
  collections, an opening explorer, and a spaced-repetition repertoire drill.
- **Review** — eval bar, per-side accuracy, a verdict per move, opening names, jumps
  between mistakes, PGN/FEN in and out.
- **Progression** — XP, coins, achievements, streaks, a leaderboard, and a store of
  titles to wear.
- **Terminal-native** — `ctrl+k` goes to any screen, `?` shows the keys, clipboard and
  bell work over SSH, 30+ themes.

## Install

Grab a standalone binary for Linux, macOS or Windows from the
[latest release](https://github.com/HilthonTT/OpenChess/releases/latest) — no Bun
needed — and run `openchess`. Local play and `--fen` / `--pgn` analysis work offline;
everything with an account talks to the API at `API_URL`.

```sh
openchess                  # the menu
openchess puzzles          # straight to a screen
openchess --pgn game.pgn   # review a game, no account needed
openchess --theme nord     # pick a theme for this session
```

Pieces look clipped? Your font has no chess glyphs — use `--pieces letters`.
Flags and every screen's keys: **[docs/playing.md](docs/playing.md)**.

## Development

Needs [Bun](https://bun.sh) 1.3+ (and PostgreSQL for the server).

```sh
bun install
bun run dev:cli      # the game
bun run dev:web      # the browser build
bun run dev:server   # the API — see docs/server.md for env and database setup
bun test && bun run typecheck && bun run lint
```

| Package | |
| --- | --- |
| [`cli`](packages/cli) | The game — an [OpenTUI](https://github.com/sst/opentui) React app |
| [`web`](packages/web) | The browser build — Next.js, static export |
| [`server`](packages/server) | The HTTP API — [Hono](https://hono.dev) with OpenAPI docs |
| [`database`](packages/database) | The [Prisma](https://www.prisma.io) schema and client, on PostgreSQL |
| [`shared`](packages/shared) | The chess engine, the progression rules, the chat catalog |

- **[docs/server.md](docs/server.md)** — environment variables, migrations, importing
  the Lichess puzzle database, the live-game event stream, API error format.
- **[DESIGN.md](DESIGN.md)** — the parts where the obvious implementation is the
  wrong one: presence without a connection, castling on a shuffled back rank, six
  bots out of one engine, and more.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** · [Code of Conduct](CODE_OF_CONDUCT.md) ·
  [Security policy](SECURITY.md)

The engine is verified with [perft](https://www.chessprogramming.org/Perft); search is
alpha-beta negamax with a quiescence search past the horizon.

## License

[MIT](LICENSE)
