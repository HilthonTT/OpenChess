import type { ReactNode } from "react";
import {
  FILES,
  isPiece,
  pieceAt,
  pieceColor,
  squareAt,
} from "@openchess/shared";
import type { Board as BoardState, Move, Premove } from "@openchess/shared";
import { useBoardTheme } from "../providers/theme";
import { usePieceSet } from "../providers/pieces";
import { renderPiece } from "./pieces";

interface BoardProps {
  board: BoardState;
  cursor: number;
  selected: number | null;
  targets: Move[];
  lastMove: Move | null;
  checkSquare: number | null;
  flipped: boolean;
  premove?: Premove | null;
  arrows?: readonly Move[];
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
  premove = null,
  arrows = [],
}: BoardProps) {
  const theme = useBoardTheme();
  const pieceSet = usePieceSet();

  const moveTargets = new Set(targets.map((move) => move.to));
  const captureTargets = new Set(
    targets.filter((move) => move.captured !== null).map((move) => move.to),
  );

  const arrowSquares = new Map<number, { primary: boolean; head: boolean }>();
  for (const [index, move] of [...arrows].reverse().entries()) {
    const primary = index === arrows.length - 1;
    arrowSquares.set(move.from, { primary, head: false });
    arrowSquares.set(move.to, { primary, head: true });
  }

  const ranks = [7, 6, 5, 4, 3, 2, 1, 0];
  const files = [0, 1, 2, 3, 4, 5, 6, 7];
  const orderedRanks = flipped ? [...ranks].reverse() : ranks;
  const orderedFiles = flipped ? [...files].reverse() : files;

  function cell(square: number): ReactNode {
    const piece = pieceAt(board, square);
    const isTarget = moveTargets.has(square);

    const arrow = arrowSquares.get(square);
    const glyph =
      isTarget && !isPiece(piece)
        ? "."
        : arrow?.head && !isPiece(piece)
          ? "●"
          : renderPiece(piece, pieceSet);

    let fg = isPiece(piece)
      ? pieceColor(piece) === "w"
        ? theme.whitePiece
        : theme.blackPiece
      : theme.moveHint;
    let bg: string | undefined;

    if (isTarget && captureTargets.has(square)) {
      fg = theme.captureHint;
    }

    if (square === cursor) {
      bg = theme.cursorBg;
      fg = theme.cursorFg;
    } else if (square === selected) {
      bg = theme.selectedBg;
      fg = theme.selectedFg;
    } else if (premove && (square === premove.from || square === premove.to)) {
      bg = theme.premoveBg;
      fg = theme.premoveFg;
    } else if (square === checkSquare) {
      bg = theme.checkBg;
      fg = theme.checkFg;
    } else if (arrow) {
      bg = arrow.primary ? theme.arrowBg : theme.replyArrowBg;
      fg = arrow.primary ? theme.arrowFg : fg;
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
