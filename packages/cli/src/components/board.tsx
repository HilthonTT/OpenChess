import type { ReactNode } from "react";
import {
  FILES,
  isPiece,
  pieceAt,
  pieceColor,
  squareAt,
} from "@openchess/shared";
import type { Board as BoardState, Move } from "@openchess/shared";
import { useBoardTheme } from "../providers/theme";
import { renderPiece } from "./pieces";

/**
 * Renders a position as a human readable grid. Pieces and empty squares are
 * arranged in a grid-like pattern. The square under the cursor and the selected
 * piece are highlighted, legal moves for the selected piece are marked with a
 * dot (.) on empty squares, and pieces that may be captured are highlighted.
 *
 * For example, with the white pawn on E2 selected we mark E3 and E4:
 *
 *    ┌───┬───┬───┬───┬───┬───┬───┬───┐
 *  8 │ ♖ │ ♘ │ ♗ │ ♕ │ ♔ │ ♗ │ ♘ │ ♖ │
 *    ├───┼───┼───┼───┼───┼───┼───┼───┤
 *  7 │ ♙ │ ♙ │ ♙ │ ♙ │ ♙ │ ♙ │ ♙ │ ♙ │
 *    ├───┼───┼───┼───┼───┼───┼───┼───┤
 *  6 │   │   │   │   │   │   │   │   │
 *    ├───┼───┼───┼───┼───┼───┼───┼───┤
 *  5 │   │   │   │   │   │   │   │   │
 *    ├───┼───┼───┼───┼───┼───┼───┼───┤
 *  4 │   │   │   │   │ . │   │   │   │
 *    ├───┼───┼───┼───┼───┼───┼───┼───┤
 *  3 │   │   │   │   │ . │   │   │   │
 *    ├───┼───┼───┼───┼───┼───┼───┼───┤
 *  2 │ ♟ │ ♟ │ ♟ │ ♟ │ ♟ │ ♟ │ ♟ │ ♟ │
 *    ├───┼───┼───┼───┼───┼───┼───┼───┤
 *  1 │ ♜ │ ♞ │ ♝ │ ♛ │ ♚ │ ♝ │ ♞ │ ♜ │
 *    └───┴───┴───┴───┴───┴───┴───┴───┘
 *      A   B   C   D   E   F   G   H
 */
interface BoardProps {
  board: BoardState;
  /** The square the player is standing on. */
  cursor: number;
  /** The piece the player has picked up, if any. */
  selected: number | null;
  /** Legal moves for the selected piece; drives the dots and capture marks. */
  targets: Move[];
  /** The move just played, highlighted so it's easy to see what happened. */
  lastMove: Move | null;
  /** The king of a side that stands in check, if any. */
  checkSquare: number | null;
  /** Draw from black's point of view. */
  flipped: boolean;
}

const LABEL_WIDTH = "   ";

function gridLine(left: string, join: string, right: string): string {
  return `${LABEL_WIDTH}${left}${Array(8).fill("───").join(join)}${right}`;
}

export function Board({
  board,
  cursor,
  selected,
  targets,
  lastMove,
  checkSquare,
  flipped,
}: BoardProps) {
  const theme = useBoardTheme();

  const moveTargets = new Set(targets.map((move) => move.to));
  const captureTargets = new Set(
    targets.filter((move) => move.captured !== null).map((move) => move.to),
  );

  const ranks = [7, 6, 5, 4, 3, 2, 1, 0];
  const files = [0, 1, 2, 3, 4, 5, 6, 7];
  const orderedRanks = flipped ? [...ranks].reverse() : ranks;
  const orderedFiles = flipped ? [...files].reverse() : files;

  function cell(square: number): ReactNode {
    const piece = pieceAt(board, square);
    const isTarget = moveTargets.has(square);

    // An empty square the selected piece can reach shows a dot; an occupied one
    // keeps its glyph and is recolored to read as capturable.
    const glyph = isTarget && !isPiece(piece) ? "." : renderPiece(piece);

    let fg = isPiece(piece)
      ? pieceColor(piece) === "w"
        ? theme.whitePiece
        : theme.blackPiece
      : theme.moveHint;
    let bg: string | undefined;

    if (isTarget && captureTargets.has(square)) {
      fg = theme.captureHint;
    }

    // Most specific highlight wins: where you are, then what you're holding,
    // then a king in trouble, then the move that was just played.
    if (square === cursor) {
      bg = theme.cursorBg;
      fg = theme.cursorFg;
    } else if (square === selected) {
      bg = theme.selectedBg;
      fg = theme.selectedFg;
    } else if (square === checkSquare) {
      bg = theme.checkBg;
      fg = theme.checkFg;
    } else if (
      lastMove &&
      (square === lastMove.from || square === lastMove.to)
    ) {
      bg = theme.lastMoveBg;
    }

    return (
      <span key={`cell-${square}`} fg={fg} bg={bg}>
        {` ${glyph} `}
      </span>
    );
  }

  function rankRow(y: number): ReactNode {
    const nodes: ReactNode[] = [
      <span key="label" fg={theme.coordinate}>{` ${y + 1} `}</span>,
    ];

    for (const x of orderedFiles) {
      nodes.push(
        <span key={`bar-${x}`} fg={theme.border}>
          │
        </span>,
      );
      nodes.push(cell(squareAt(x, y)));
    }

    nodes.push(
      <span key="bar-end" fg={theme.border}>
        │
      </span>,
    );

    return <text key={`rank-${y}`}>{nodes}</text>;
  }

  const fileLabels = ` ${orderedFiles
    .map((x) => ` ${(FILES[x] as string).toUpperCase()} `)
    .join(" ")}`;

  const rows: ReactNode[] = [
    <text key="top" fg={theme.border}>
      {gridLine("┌", "┬", "┐")}
    </text>,
  ];

  orderedRanks.forEach((y, index) => {
    rows.push(rankRow(y));
    if (index < orderedRanks.length - 1) {
      rows.push(
        <text key={`sep-${y}`} fg={theme.border}>
          {gridLine("├", "┼", "┤")}
        </text>,
      );
    }
  });

  rows.push(
    <text key="bottom" fg={theme.border}>
      {gridLine("└", "┴", "┘")}
    </text>,
  );
  rows.push(
    <text key="files" fg={theme.coordinate}>
      {`${LABEL_WIDTH}${fileLabels}`}
    </text>,
  );

  return <box flexDirection="column">{rows}</box>;
}
