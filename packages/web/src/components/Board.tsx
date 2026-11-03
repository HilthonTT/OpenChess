"use client";

import {
  FILES,
  isColor,
  isPiece,
  toPiece,
  type Color,
  type Move,
  type Position,
  type PromotionPiece,
} from "@openchess/shared";
import { useMemo, useRef, useState } from "react";
import { Piece } from "./Piece";

export type BoardProps = {
  position: Position;
  orientation: Color;
  /** The side the user may move right now, or null when input is locked. */
  movable: Color | null;
  legalMoves: Move[];
  lastMove: { from: number; to: number } | null;
  check: number | null;
  promotion: { square: number; color: Color } | null;
  showTargets: boolean;
  onMove: (from: number, to: number) => void;
  onPromote: (piece: PromotionPiece | null) => void;
};

type Drag = {
  from: number;
  x: number;
  y: number;
  wasSelected: boolean;
};

const PROMOTION_ORDER: PromotionPiece[] = ["q", "n", "r", "b"];

/** Board index (0 = a8) to its row and column on screen. */
function cellOf(square: number, orientation: Color) {
  const row = Math.floor(square / 8);
  const col = square % 8;
  return orientation === "w" ? { row, col } : { row: 7 - row, col: 7 - col };
}

export function Board({
  position,
  orientation,
  movable,
  legalMoves,
  lastMove,
  check,
  promotion,
  showTargets,
  onMove,
  onPromote,
}: BoardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const active = movable !== null && promotion === null;
  const selection = active ? selected : null;

  const targets = useMemo(() => {
    if (selection === null) {
      return new Set<number>();
    }
    return new Set(
      legalMoves.filter((move) => move.from === selection).map((m) => m.to),
    );
  }, [legalMoves, selection]);

  function squareAtPoint(x: number, y: number): number | null {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) {
      return null;
    }
    let col = Math.floor(((x - rect.left) / rect.width) * 8);
    let row = Math.floor(((y - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) {
      return null;
    }
    if (orientation === "b") {
      col = 7 - col;
      row = 7 - row;
    }
    return row * 8 + col;
  }

  function isTarget(from: number, to: number) {
    return legalMoves.some((move) => move.from === from && move.to === to);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!active || event.button !== 0) {
      return;
    }
    const square = squareAtPoint(event.clientX, event.clientY);
    if (square === null) {
      return;
    }

    // A target wins over selecting a piece, which is what lets a Chess960
    // king castle by landing on its own rook.
    if (selection !== null && isTarget(selection, square)) {
      setSelected(null);
      onMove(selection, square);
      return;
    }

    const content = position.board[square] ?? "";
    if (isPiece(content) && isColor(content, movable)) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        from: square,
        x: event.clientX,
        y: event.clientY,
        wasSelected: selection === square,
      });
      setSelected(square);
    } else {
      setSelected(null);
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (drag) {
      setDrag({ ...drag, x: event.clientX, y: event.clientY });
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag) {
      return;
    }
    const square = squareAtPoint(event.clientX, event.clientY);
    setDrag(null);

    if (
      square !== null &&
      square !== drag.from &&
      isTarget(drag.from, square)
    ) {
      setSelected(null);
      onMove(drag.from, square);
    } else if (square === drag.from && drag.wasSelected) {
      setSelected(null);
    }
  }

  const squareSize = (ref.current?.getBoundingClientRect().width ?? 0) / 8;

  const cells = [];
  for (let square = 0; square < 64; square += 1) {
    const { row, col } = cellOf(square, orientation);
    const light = (Math.floor(square / 8) + (square % 8)) % 2 === 0;
    const content = position.board[square] ?? "";
    const classes = ["sq", light ? "sq-light" : "sq-dark"];

    if (lastMove && (lastMove.from === square || lastMove.to === square)) {
      classes.push("sq-last");
    }
    if (selection === square) {
      classes.push("sq-selected");
    }
    if (check === square) {
      classes.push("sq-check");
    }
    if (showTargets && targets.has(square)) {
      classes.push(isPiece(content) ? "sq-capture" : "sq-target");
    }

    const dragging = drag?.from === square;

    cells.push(
      <div
        key={square}
        className={classes.join(" ")}
        style={{ gridRow: row + 1, gridColumn: col + 1 }}
      >
        {col === 0 && (
          <span className="coord coord-rank">{8 - Math.floor(square / 8)}</span>
        )}
        {row === 7 && (
          <span className="coord coord-file">{FILES[square % 8]}</span>
        )}
        {isPiece(content) && (
          <div className={`piece-wrap${dragging ? " piece-dragging" : ""}`}>
            <Piece piece={content} />
          </div>
        )}
      </div>,
    );
  }

  let picker = null;
  if (promotion) {
    const { row, col } = cellOf(promotion.square, orientation);
    const fromTop = row === 0;
    picker = (
      <div className="promo-backdrop" onPointerDown={() => onPromote(null)}>
        <div
          className="promo"
          style={{
            left: `${col * 12.5}%`,
            top: fromTop ? 0 : undefined,
            bottom: fromTop ? undefined : 0,
            flexDirection: fromTop ? "column" : "column-reverse",
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {PROMOTION_ORDER.map((type) => (
            <button
              key={type}
              type="button"
              className="promo-option"
              onClick={() => onPromote(type)}
              aria-label={`Promote to ${type}`}
            >
              <Piece piece={toPiece(type, promotion.color)} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  const dragged = drag ? position.board[drag.from] : undefined;

  return (
    <div className="board-frame">
      <div
        ref={ref}
        className={`board${active ? " board-active" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDrag(null)}
        onContextMenu={(event) => event.preventDefault()}
      >
        {cells}
        {picker}
      </div>
      {drag && dragged && isPiece(dragged) && (
        <div
          className="piece-ghost"
          style={{
            width: squareSize,
            height: squareSize,
            transform: `translate(${drag.x - squareSize / 2}px, ${drag.y - squareSize / 2}px)`,
          }}
        >
          <Piece piece={dragged} />
        </div>
      )}
    </div>
  );
}
