# Design notes

Why OpenChess works the way it does. The [README](README.md) covers what it is and
how to run it; this is the reasoning behind the parts where the obvious
implementation is the wrong one.


## Asking the terminal

The clipboard and the bell are escape sequences written to stdout rather than
programs shelled out to, which is what makes them work over SSH: the clipboard
worth writing to is at the near end, everything this process could spawn is at the
far end. `y` copies a FEN and `shift+y` a PGN over
[OSC 52](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Operating-System-Commands);
tmux forwards it under its default `set-clipboard external`. Nothing comes back
from a terminal that was asked, so what *can* be known is checked first: redirected
output gets nothing written into it, and a payload past 64 KiB is refused, since a
terminal that truncates an OSC string leaves the clipboard holding half a game and
says nothing.

**A game the server is paying out on does not give up its position until it is
over** — `y` says so and copies nothing until the result is in. Local 1v1 and the
offline engine game have the same board and no such rule; Watch is deliberately
not held back, since that is somebody else's game.

The bell is `BEL` plus an [OSC 9](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Operating-System-Commands)
notification, which iTerm2, WezTerm, Ghostty, Konsole and Windows Terminal raise
on the desktop and everything else discards. It rings when the queue pairs you,
when a draw is offered, when a game ends, and when the opponent moves *after a
think longer than twenty seconds* — one beep a move would make bullet unplayable.
Control characters are stripped from every message, since opponents' names go in
them and a name carrying its own `BEL` would be a way to drive someone's terminal.

## Friends, presence and chat

**Presence is derived, never declared.** No "go online" call and no connection held
open: an authenticated request records that you were here, and the rest is
arithmetic on that timestamp. Online for five minutes after the last request,
`playing` if there is also an unfinished online game, offline otherwise — in that
order, since a player who walked away mid-game would otherwise read as "playing"
forever. The write is throttled to once a minute and never awaited.

**A friendship is one row, and mutual requests resolve rather than pile up.**
Asking someone who has already asked you accepts their request; asking again while
yours stands returns the one already sent; a decline answers one request rather
than being a verdict.

**A profile is a strict subset of `/me`** — record, rating and curve, title,
achievements, recent games. No wallet, no ledger, no account identity, enforced by
projecting field by field, so a column added to `User` tomorrow is invisible on a
profile until somebody writes it down.

**Chat is nine phrases and no free text.** The wire carries a key like `goodGame`
and the receiving client looks up what it means, so nothing one player controls
ever reaches the other's screen — safe by construction rather than by filtering, so
no moderation queue, no mute list, no report flow. Capped per player per game,
since nine phrases cannot be abusive one at a time but a hundred in a row can.
Players only; the watch feed carries no chat at all.

## Draws by agreement

Online games only — agreeing takes two players and the bot is not one of them. One
offer stands at a time: **the opponent's move declines it**, exactly as playing on
does over a board; **your own move does not**, since offering and then moving is
the ordinary habit; whatever ends the game clears it; either player may clear it
outright. Both offering at the same instant settles the game rather than
deadlocking two clients each waiting on the other.

An agreed draw is rated and paid like a drawn position — half a point, Elo against
the pre-game rating, XP but no coins — and held to the same ten-ply floor as every
result, which closes two accounts shaking hands at move one to farm a `draws`
column. Nothing legitimate is caught: stalemate, repetition and insufficient
material are all out of reach inside ten plies.

## Progression

Finished server games pay XP and coins scaled by difficulty — wins most, draws
some, losses a consolation of XP only. Under ten plies pays nothing, so
resign-farming is worthless. Payouts can unlock achievements, which grant one-time
bonuses; coins buy titles, and the equipped one shows on the leaderboard.

**Puzzles run on their own Elo ladder**, kept apart from the game rating on
purpose: one number for both would let a player farm either side of it into a rank
they cannot hold. A solve pays by how far above your rating the puzzle sat, capped
at both ends; a failure pays nothing, since a puzzle can be failed deliberately in
one keystroke. Each puzzle scores once per player — the attempt row is the
idempotency key. A hint halves both the payout and the rating swing, and the server
records that you took it rather than asking the client to own up.

**Your rating is kept as a curve as well as a number.** Every settle that moves it
writes a point in the same transaction that banks the rating, so the history can
never disagree with the scalar the leaderboard sorts on. Only real movement is
recorded, which makes the series shorter than your game count on purpose; `peak`
reads over all of history.

**Signing in claims that day's streak.** Consecutive days pay more up to a cap on
the seventh, worth about half a won online game. UTC days, a missed day restarts at
one, the claim is idempotent, and streaks of 3, 7 and 30 unlock achievements.

## The bots

A difficulty slider answers "how hard is this to beat" and nothing else, so three
of them is three of the same opponent at three speeds. What makes a bot worth
playing twice is that it *wants* something.

| Bot | ~Elo | Plays |
| --- | --- | --- |
| Rookie | 400 | At random, throughout |
| Gambiteer | 1100 | Gives up pawns for the initiative, and means it |
| Fortress | 1150 | Trades the fireworks for a structure you cannot break |
| Grinder | 1600 | Swaps down, pushes a pawn, and will not agree to anything |
| Tactician | 1650 | Hunts for the tactic, and keeps the position sharp enough to have one |
| Maestro | 1750 | No preferences. The engine as it comes |

Four levers, and none of them is a different engine:

- **Evaluation weights** — multipliers on material, piece-square tables, pawn
  structure, passed pawns, the bishop pair, rook files, the king's shield. The
  Gambiteer discounts material to 0.82 and pays 1.3 for activity, which is enough
  that a pawn for two developing moves reads as a good trade without anyone writing
  down what a gambit is; the Fortress weights its king shield at 1.9. Only *ratios*
  matter, which is what makes them tunable one at a time.
- **Contempt** — what a draw is worth in centipawns. The Grinder's is +45, so it
  plays on in level rook endings; the Fortress's is −20. Applied by whose turn it is
  rather than by ply count, which keeps contempt out of the transposition table's hair.
- **The book** — lines carry an optional `style` (`gambit`, `sharp`, `solid`,
  `classical`), credited to every move along a line rather than to its last, so a bot
  asked for gambits is pulled towards `f4` from move one. A bias, not a filter.
- **Going wrong** — the weaker bots play a random legal move some of the time (6%
  Gambiteer, 5% Fortress, never the top three), because going wrong occasionally and
  badly is much closer to how a weaker player actually loses than playing every move
  slightly less well. The Rookie slips on every move, which is what makes it play at
  random without needing a case of its own.

A personality is a style *and* a strength, and the strength still maps onto the
three tiers, because rewards and rating scale by tier. Games store both, so retuning
a bot cannot silently reprice every game played against it.

## Chess960

The back rank is shuffled; the pawns, the rules and where castling *ends* are not.
Arrays are numbered 0–959 by Scharnagl's scheme, and #518 being the ordinary game is
what lets one code path serve both variants.

Castling is the whole of what changes, and it is the one rule that cares where a
piece *started*, so a position carries the files its king and rooks began on. Three
cases a normal array can never produce are what a naive implementation gets wrong,
and all 960 are tested: a king that castles **without moving at all**, a rook that
lands on the square the king just left, and a king that travels *left* to castle
king-side. All three make the four squares overlap, so both pieces are lifted before
either is put down.

Castling is written **king-takes-rook** (`g1h1`) in a shuffled game and `e1g1` in an
ordinary one — not stylistic: on a shuffled array `b1c1` is both "king steps right"
and "castles queenside". FENs write `KQkq` when it can only mean one thing and name
the rooks' files (`HAha`, Shredder-FEN) when it cannot, so every existing FEN
round-trips byte for byte; exported PGN carries `[Variant "Chess960"]`. The array is
dealt server-side and stored as `startFen`, since a shuffled game that only stored
its moves would replay onto the standard array. Challenges deal it on *acceptance*,
so one that sat in an inbox overnight cannot have been studied by the sender.

## Puzzle Rush

Three minutes, five minutes, or survival — no clock, just the three mistakes. Same
protocol as the tactics trainer, with three deliberate differences. It is
**server-timed**: `endsAt` is written when the run starts and every submission is
checked against it, because a score a client's own timer could vouch for is not a
score. It is **off the ladder** — no attempt row, no rating movement — since rushing
rewards speed and rating rewards accuracy. And it pays **once, at the end**, guarded
by the run's own `rewardsGranted` flag: per solve would make a run a coin faucet you
tap by abandoning it at nine. The ramp is linear — 35 points a solve from 600,
levelling off at 2600 — because a ramp that got hard quickly would make the whole
score depend on the first thirty seconds.

## Puzzle themes

Stored puzzles carry free-form theme tags, because the corpus decides what it tags.
`chess/puzzle-themes.ts` is the display side: the ones worth naming and which a
player would sensibly train. An unknown theme still filters and still shows, under an
un-camel-cased version of its raw key, because silently dropping them would make a
freshly imported corpus look half-empty. Not everything is worth training — `fork`
and `backRankMate` name something to practise, `middlegame` and `crushing` describe a
puzzle; both show, only the first is offered as a filter. Filtering is
`themes @> ARRAY['fork']`, which a b-tree cannot answer, so the column carries a GIN
index — without it, serving a themed puzzle is a sequential scan of the whole corpus.

## The opening book

Before the search runs, the engine looks the position up. About a hundred named lines
in `chess/opening-lines.ts` are folded into a trie of one node per position, and every
line is replayed through the engine by its test, so an authoring slip cannot ship as a
bot with no move to make.

Positions are keyed the way threefold repetition keys them, which makes the book
transposition-aware without being asked: `1.e4 e5 2.Nf3 Nc6 3.Bc4` and
`1.e4 e5 2.Bc4 Nc6 3.Nf3` are one key, so both are the Italian. The choice among
continuations is weighted rather than always-the-mainline, and a line's weight is added
to every move along it, so a branch's pull is the sum of what runs through it — which
also makes the explorer's percentages a reading of *this book*, not of a database of
master games. `easy` skips the book along with the search: a beginner's opponent that
opens with ten plies of the Najdorf and then hangs its queen is a worse teacher than
one that is bad throughout.

Naming runs the other way out of the same trie. A game is called after the deepest
opening it passed through, not its current position, because a game leaves the book
long before it stops being a Sicilian. That is what Analysis shows as you step and what
`[ECO]` and `[Opening]` carry into an exported PGN — written only when the book
recognises the game, since `[Opening "?"]` claims the opening is unknown rather than
unasked.

