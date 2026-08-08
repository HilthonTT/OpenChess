# Contributing to OpenChess

Thanks for wanting to help. This is a chess game that lives in a terminal, and
most of what makes it good is small: a key that does the obvious thing, a screen
that says why it can't do what you asked, a rule the engine gets right at the
edge. Those are all welcome.

## Before you start

- **Bugs and small fixes** — open a PR. No need to ask first.
- **A new screen, a new key, or anything that changes how the game feels** —
  open an issue or a [discussion](https://github.com/HilthonTT/OpenChess/discussions)
  first. The keymap is crowded, and a key that means one thing on one screen and
  something else on another is worse than no key at all.
- **Anything touching the database schema** — say so in the issue. Migrations
  are applied to real data, and the seed has to stay idempotent.

## Setting up

Needs [Bun](https://bun.sh) 1.3+ and a PostgreSQL database.

```sh
bun install
cp .env.example .env      # then fill it in — the server refuses to boot without
bun run db:migrate
bun run db:seed
```

The [README](README.md#setup) documents every variable and which ones are
actually required. Then, in two terminals:

```sh
bun run dev:server   # the API, on http://localhost:3000
bun run dev:cli      # the game
```

You can work on the CLI without a server: Local 1v1, Play vs AI and Analysis of
a PGN file all run entirely on your machine. Everything else needs both halves
and an account.

## The three checks

```sh
bun run lint        # Biome: formatting and lint in one pass
bun run typecheck
bun test
```

All three run in CI on every pull request, and all three have to pass. The
tests run on Linux, macOS and Windows — the CLI is a terminal application, and
the clipboard, the desktop notifier and PGN path handling all differ per
platform.

`bun run lint:fix` applies everything Biome can fix on its own, and
`bun run format` formats without touching lint. Configuration lives in
[`biome.jsonc`](biome.jsonc), which records why each rule is off where it is.

Two things worth knowing before you fight the formatter:

- **Line endings are LF**, pinned by `.gitattributes`. If you are on Windows and
  have `core.autocrlf=true`, a fresh clone still gets LF here — without that,
  Biome would report every file in the repo as unformatted on your machine and
  none of them in CI.
- **Some layouts are deliberate.** The piece-square tables in
  `chess/evaluate.ts` are 8×8 because the grid *is* the board, and the opening
  lines are wrapped in move pairs so they read like a score sheet. Those carry a
  `// biome-ignore format:` with the reason. If you are adding data whose shape
  is the documentation, do the same rather than letting it collapse into a run
  of numbers.

Lint warnings do not block a merge. Errors do. The warnings that remain today
are mostly `useExhaustiveDependencies` on the CLI's hooks — real questions about
stale closures, each needing a judgement about what its effect is meant to
observe, and left visible rather than silenced.

## Writing the code

A few conventions that are not obvious from the outside:

**Comments say *why*, not *what*.** The code already says what it does. A
comment earns its place by recording the reason something is the way it is —
the case that forced it, the alternative that looked right and wasn't. Look at
`packages/cli/src/providers/keymap/index.tsx` or `lib/keymaps.ts` for the
register.

**A screen declares its keys.** Call `useKeymap` with what the screen answers
to, so `?` describes the keys that are *live* right now. A screen that has
handed control to a child form registers `null` instead — the same condition its
keyboard handler already tests, so the two cannot drift apart.

**Shared keys come from `lib/keymaps.ts`.** The board cursor is not described
five slightly different ways.

**Screens are registered in one place.** `lib/screens.ts` is what the router
builds its routes from *and* what the argument parser validates against, so a
screen added there reaches both at once.

**Dialog contents cannot reach every provider.** The dialog provider renders
dialogs as a sibling of its children, and it sits above the toast and auth
providers — so `useToast` and `useAuth` throw inside a dialog. Pass what the
dialog needs in as props from a component that can see them; `GlobalKeys` does
this for the `ctrl+k` palette.

## Tests

`bun test` runs everything. The interesting ones for a UI change are the TUI
tests, which drive the real renderer through `testRender` and assert on the
captured character frame — see `packages/cli/src/components/dialogs/help-dialog.test.tsx`
for the pattern, including how to press keys and wait for a frame.

What is worth a test:

- **Engine rules.** Move generation is verified with
  [perft](https://www.chessprogramming.org/Perft) against the standard
  positions. A rule change that does not move those numbers has not been tested.
- **Anything with an edge.** Castling out of a Chess960 corner, a clock that
  falls on the same tick as a mate, a stream event that is a message rather than
  a move.
- **A key that now does something different.** The `?` overlay tests exist
  because the overlay listing another screen's keys is the exact failure nobody
  notices in review.

Be aware that a test which depends on being *signed out* is not reliable: the
auth provider reads `~/.openchess/auth.json`, and an unreachable server keeps a
saved token signed in. There is no injection point for it yet.

## Commits and pull requests

Commit subjects follow [Conventional Commits](https://www.conventionalcommits.org)
loosely — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`. Keep the subject under
about 72 characters and put the reasoning in the body.

Branch off `main` and open the PR against it. The
[pull request template](.github/PULL_REQUEST_TEMPLATE.md) asks what changed, why,
and how you checked it — a screenshot of the terminal is worth a lot for
anything visual, since a description of a layout is never quite the layout.

Small, focused PRs get reviewed faster than large ones. If a change turns out to
need a refactor underneath it, the refactor is welcome as its own PR first.

## Code of conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
