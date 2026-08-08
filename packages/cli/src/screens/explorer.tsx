import { useCallback, useMemo, useState } from "react";
import { useKeyboard } from "@opentui/react";
import {
  bookMoves,
  createGame,
  findKing,
  openingOf,
  play,
  playSan,
  undo,
} from "@openchess/shared";
import type { BookMove, Game, OpeningLine } from "@openchess/shared";
import { Board } from "../components/board";
import { OpeningDialogContent } from "../components/dialogs/opening-dialog";
import { GameScreen } from "../components/game-screen";
import { HintBar } from "../components/hint-bar";
import { MoveList } from "../components/game-panels";
import { useDialog } from "../providers/dialog";
import { BASE_LAYER_ID, useKeyboardLayer } from "../providers/keyboard-layer";
import { isHelpKey, useKeymap, type Keymap } from "../providers/keymap";
import { useUITheme } from "../providers/theme";

const TITLE = "Opening Explorer";
const SUBTITLE = "Walk the book the engine plays from";
const WIDTH = 64;
/** Room for the continuation rows without the frame growing past a short terminal. */
const VISIBLE_MOVES = 8;
/** Cells in the share bar beside each continuation. */
const BAR_W = 8;

const KEYMAP: Keymap = {
  title: "Opening Explorer",
  sections: [
    {
      title: "Walk the book",
      keys: [
        { keys: "↑↓ / jk", label: "pick a continuation" },
        { keys: "enter / → / l", label: "play it" },
        { keys: "← / h / u", label: "take one back" },
        { keys: "home / r", label: "back to the starting position" },
        { keys: "f", label: "flip the board" },
        { keys: "/", label: "jump to a line by name or ECO code" },
      ],
    },
  ],
};

/** Pad or ellipsize to exactly `width`, so the columns stay columns. */
function fit(text: string, width: number): string {
  return text.length <= width
    ? text.padEnd(width)
    : `${text.slice(0, width - 1)}…`;
}

/**
 * A share below half a percent rounds to `0%`, which reads as a move the book
 * never plays rather than one it rarely does — and it is sitting right there in
 * a list of moves you can play. Say `<1%` instead, and leave its bar empty.
 */
function formatShare(share: number): string {
  return share < 0.005 ? "  <1" : (share * 100).toFixed(0).padStart(4);
}

/**
 * The opening explorer: the same book `findBestMove` plays out of, laid out as a
 * tree you can walk.
 *
 * Only book moves can be played here, which is the whole point — there is no
 * "out of book" state to handle, just lines that end. Free play belongs on a
 * board screen, and this one answers a different question: what does theory do
 * from here, and what is it called when it gets there.
 *
 * Needs no account. The book is compiled into the client, so nothing is fetched.
 */
export function Explorer() {
  const theme = useUITheme();
  const dialog = useDialog();
  const { isTopLayer } = useKeyboardLayer();

  useKeymap(KEYMAP);

  const [game, setGame] = useState<Game>(() => createGame());
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const continuations = useMemo(() => bookMoves(game.position), [game]);
  const opening = useMemo(() => openingOf(game), [game]);

  // The list shrinks and grows as the tree is walked, so the stored index is a
  // wish rather than a fact — clamp it on the way out instead of chasing it with
  // an effect that would re-render every step.
  const cursor = Math.min(index, Math.max(0, continuations.length - 1));

  const advance = useCallback((choice: BookMove | undefined) => {
    if (!choice) {
      return;
    }
    setGame((current) => play(current, choice.move));
    setIndex(0);
  }, []);

  const back = useCallback(() => {
    setGame((current) => undo(current));
    setIndex(0);
  }, []);

  const reset = useCallback(() => {
    setGame(createGame());
    setIndex(0);
  }, []);

  /** Replay a whole line from the initial position, for the search dialog. */
  const jumpTo = useCallback((line: OpeningLine) => {
    let next = createGame();
    for (const san of line.moves) {
      next = playSan(next, san);
    }
    setGame(next);
    setIndex(0);
  }, []);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    switch (key.name) {
      case "up":
      case "k":
        setIndex(Math.max(0, cursor - 1));
        break;
      case "down":
      case "j":
        setIndex(Math.min(continuations.length - 1, cursor + 1));
        break;
      case "return":
      case "right":
      case "l":
        advance(continuations[cursor]);
        break;
      case "left":
      case "h":
      case "u":
      case "backspace":
        back();
        break;
      case "home":
      case "r":
        reset();
        break;
      case "f":
        setFlipped((value) => !value);
        break;
      case "/":
        // A terminal on the kitty protocol spells `?` as a shifted `/`, and
        // that one belongs to the help overlay — without this the search would
        // open behind it every time somebody asked for the keys.
        if (isHelpKey(key)) {
          break;
        }
        dialog.open({
          title: "Jump to an opening",
          children: <OpeningDialogContent onSelect={jumpTo} />,
        });
        break;
    }
  });

  const { position, status } = game;
  const lastMove = game.history[game.history.length - 1]?.move ?? null;
  const checkSquare =
    status === "check" || status === "checkmate"
      ? findKing(position.board, position.turn)
      : null;

  return (
    <GameScreen
      title={TITLE}
      subtitle={SUBTITLE}
      width={WIDTH}
      footer={
        <>
          <span fg={theme.cream}>↑↓</span>
          <span fg={theme.faint}> pick </span>
          <span fg={theme.cream}>enter</span>
          <span fg={theme.faint}> play </span>
          <span fg={theme.cream}>←</span>
          <span fg={theme.faint}> back </span>
          <span fg={theme.cream}>/</span>
          <span fg={theme.faint}> search </span>
        </>
      }
    >
      <box flexDirection="row" gap={2}>
        <Board
          board={position.board}
          cursor={-1}
          selected={null}
          targets={[]}
          lastMove={lastMove}
          checkSquare={checkSquare}
          flipped={flipped}
        />
        <MoveList game={game} />
      </box>

      <OpeningLabel opening={opening} plies={game.history.length} />

      <Continuations moves={continuations} cursor={cursor} />

      <HintBar
        hints={[
          { key: "r", label: "restart" },
          { key: "f", label: "flip" },
        ]}
      />
    </GameScreen>
  );
}

/** What the position on the board is called, with its ECO volume. */
function OpeningLabel({
  opening,
  plies,
}: {
  opening: ReturnType<typeof openingOf>;
  plies: number;
}) {
  const theme = useUITheme();

  return (
    <box flexDirection="column" width={WIDTH - 6}>
      {opening ? (
        <text>
          <span fg={theme.faint}>{`${opening.eco}  `}</span>
          <span fg={theme.gold}>{opening.name}</span>
        </text>
      ) : (
        <text fg={theme.faint}>
          {plies === 0
            ? "The starting position — pick a first move"
            : "No name for this position yet"}
        </text>
      )}
    </box>
  );
}

/**
 * The moves the book plays from here, heaviest first, with the share of the book
 * that runs through each and the opening it arrives at.
 */
function Continuations({
  moves,
  cursor,
}: {
  moves: BookMove[];
  cursor: number;
}) {
  const theme = useUITheme();

  if (moves.length === 0) {
    return (
      <box flexDirection="column" width={WIDTH - 6}>
        <text fg={theme.walnut}>End of the line</text>
        <text fg={theme.faint}>
          The book stops here — take a move back, or start again.
        </text>
      </box>
    );
  }

  // Keep the highlighted row on screen without scrolling the whole frame: the
  // window slides only once the cursor would leave it.
  const start =
    moves.length <= VISIBLE_MOVES
      ? 0
      : Math.max(0, Math.min(cursor - 3, moves.length - VISIBLE_MOVES));
  const visible = moves.slice(start, start + VISIBLE_MOVES);

  return (
    <box flexDirection="column" width={WIDTH - 6}>
      <text>
        <span fg={theme.walnut}>Continuations</span>
        <span fg={theme.faint}>{`  (${moves.length})`}</span>
      </text>

      {visible.map((entry, offset) => {
        const active = start + offset === cursor;
        // At least one cell for anything the bar can honestly round up to, so a
        // one-percent line is visible rather than indistinguishable from none.
        const filled =
          entry.share < 0.005
            ? 0
            : Math.max(1, Math.round(entry.share * BAR_W));

        return (
          <text key={entry.san} bg={active ? theme.selectionBg : undefined}>
            <span fg={active ? theme.gold : theme.faint}>
              {active ? "▸ " : "  "}
            </span>
            <span fg={active ? theme.cream : theme.text}>
              {entry.san.padEnd(7)}
            </span>
            <span fg={theme.gold}>{"█".repeat(filled)}</span>
            <span fg={theme.faint}>{"░".repeat(BAR_W - filled)}</span>
            <span fg={theme.dim}>{`${formatShare(entry.share)}%  `}</span>
            <span fg={active ? theme.text : theme.dim}>
              {fit(entry.leadsTo?.name ?? "—", 26)}
            </span>
          </text>
        );
      })}
    </box>
  );
}
