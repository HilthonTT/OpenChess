# Playing

```sh
openchess                       # the menu
openchess puzzles               # straight to the tactics trainer
openchess profile hikaru        # somebody's record, by name
openchess --local --theme nord  # a screen may also be written as a flag
openchess --pgn game.pgn        # review a game from a file
openchess --fen 8/8/8/8/8/8/8/K6k w - - 0 1   # or a bare position
```

In the workspace, arguments go after `--`: `bun run dev:cli -- puzzles --theme nord`.

## Flags

| Flag | What it does |
| --- | --- |
| `--theme <name>` | Any name from `--themes`, spelled however you like — `nord`, `tokyo-night`, `Rosé Pine`. This session only; it does not touch what the picker saved |
| `--fen <fen>` | Open Analysis on a position. Quotes optional — an unquoted FEN arrives as six arguments and is read back into one |
| `--pgn <file>` | Open Analysis on a game in a PGN file, without typing the path in |
| `--pieces <set>` | `unicode` for figurines, `letters` for `K Q R B N P`. This session only, like `--theme` |
| `--no-bell` | Don't ring the terminal for a match or a move |
| `--bell` | Ring it even where `OPENCHESS_BELL` turned it off |
| `--help` | Every screen; `--version` prints the version |

`--fen` and `--pgn` are the two ways into Analysis that need no account: the
position or the file is the whole of it, and the engine runs here. A FEN it
cannot read is refused on the command line rather than by clearing the terminal
to say so, so `openchess --fen "$(pbpaste)"` either opens a board or prints one
line.

**If the pieces come out clipped or half-drawn, use `--pieces letters`.** Most
monospace fonts carry no chess figurines — Cascadia Mono among them — so the
terminal borrows them from whatever fallback font does, and a fallback glyph cut
to fit a cell it was not measured for is what you see. The letters set is `K Q R
B N P`, uppercase for white and lowercase for black the way a FEN spells it, and
it renders in any font. `ctrl + k` → "Piece set" switches between them and
remembers which you picked.

The CLI reads three environment variables: `API_URL` (default
`http://localhost:3000/api`), `OPENCHESS_FPS` (default `60`), and
`OPENCHESS_BELL` (`0`/`off`/`false`/`no` turns the bell off for good).

## Keys

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
| Online 1v1 | `d`/`n` draw and refusal (offering takes `d` twice), `u` asks for a takeback and answers theirs, `x` twice resigns, `t` then `1`–`9` says a phrase, `c` claims a win from an opponent who left, `p` offers a rematch |
| Analysis | `←→` step, `home`/`end` jump to an end, `n`/`p` to the next and previous mistake, `e` writes a PGN to `~/openchess`, `i` reads one in, `y` copies the position you are *looking at* |
| Puzzles | `t` hint (names the square, halves the payout), `s` gives up, `n` next, `d` swaps the rated queue for the daily, `/` picks a motif to train |
| Puzzle Rush | `1`–`3` start a mode, `←→` browse first, `x` banks a run where it stands, `n` starts another. No hint and no solution during a run |
| Collections | `↑↓` browse, `enter` trains the set’s motif in the puzzle screen, `c` claims a finished one |
| Local 1v1 | `9` switches between the ordinary array and a shuffled one, dealing a fresh position |
| Openings | `↑↓` pick a continuation, `enter` plays it, `←` takes one back, `/` searches by name or ECO, `a` / `shift+a` keeps the walked line to drill as White or as Black. Only book moves play |
| Repertoire | `↑↓` browse, `enter` drills the selected line, `d` drills the next one due, `x` twice drops a line, `s` gives up on a drill mid-line |
| Watch | `t` then `1`–`9` says a phrase to the other spectators — their own channel, invisible to the players |
| Challenges | `←→` inbox and sent, `enter` accepts, `d` declines, `x` withdraws, `n` writes one, `c` joins by code |
| Friends | `←→` friends, inbox, sent; `enter` opens a profile, `c` challenges, `x` twice removes, `a` searches by name |
| Profile | `f` asks or accepts, `d` declines, `x` twice unfriends, `c` challenges |
| Leaderboard | `↑↓` browse, `←→` page, `s` cycles the sort, `r` refreshes |
| Store | `enter` twice buys, equips, or unequips |
