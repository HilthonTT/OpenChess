import { useCallback, useState } from "react";
import {
  findLegalMove,
  isPiece,
  movesFromSquare,
  needsPromotion,
  pieceAt,
  pieceColor,
} from "@openchess/shared";
import type { Color, Game, PromotionPiece } from "@openchess/shared";
import { colorName } from "../components/game-panels";

export interface PendingPromotion {
  from: number;
  to: number;
}

export type CommitMove = (
  from: number,
  to: number,
  choice?: PromotionPiece,
) => unknown;

export function useMoveSelection({
  game,
  cursor,
  over,
  overMessage,
  you,
  locked = false,
}: {
  game: Game;
  cursor: number;
  over: boolean;
  overMessage: string;
  you?: { color: Color; waitMessage: string };
  locked?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [promotion, setPromotion] = useState<PendingPromotion | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { position } = game;
  const targets = selected === null ? [] : movesFromSquare(game, selected);

  const clearSelection = useCallback(() => {
    setSelected(null);
    setPromotion(null);
  }, []);

  const select = useCallback(
    (square: number) => {
      const piece = pieceAt(position.board, square);

      if (!isPiece(piece)) {
        setMessage("That square is empty");
        return;
      }

      if (you !== undefined) {
        if (pieceColor(piece) !== you.color) {
          setMessage(`You play the ${colorName(you.color)} pieces`);
          return;
        }
      } else if (pieceColor(piece) !== position.turn) {
        setMessage(`It's ${colorName(position.turn)}'s turn`);
        return;
      }

      if (movesFromSquare(game, square).length === 0) {
        setMessage("That piece has no legal moves");
        return;
      }

      setSelected(square);
      setMessage(null);
    },
    [game, position, you],
  );

  const confirm = useCallback(
    (commit: CommitMove) => {
      if (locked) {
        return;
      }

      if (over) {
        setMessage(overMessage);
        return;
      }

      if (you !== undefined && position.turn !== you.color) {
        setMessage(you.waitMessage);
        return;
      }

      if (selected === null) {
        select(cursor);
        return;
      }

      if (cursor === selected) {
        setSelected(null);
        return;
      }

      if (needsPromotion(game, selected, cursor)) {
        setPromotion({ from: selected, to: cursor });
        return;
      }

      if (findLegalMove(game, selected, cursor)) {
        void commit(selected, cursor);
        return;
      }

      select(cursor);
    },
    [cursor, game, locked, over, overMessage, position, select, selected, you],
  );

  const beginCommit = useCallback(
    (from: number, to: number, choice?: PromotionPiece) => {
      const move = findLegalMove(game, from, to, choice);
      if (!move) {
        setMessage("That isn't a legal move");
        return null;
      }

      setSelected(null);
      setPromotion(null);
      setMessage(null);
      return move;
    },
    [game],
  );

  const handleEscape = useCallback(
    (cancelDialog?: () => boolean) => {
      if (promotion) {
        setPromotion(null);
        return true;
      }

      if (cancelDialog?.()) {
        return true;
      }

      if (selected !== null) {
        setSelected(null);
        return true;
      }

      return false;
    },
    [promotion, selected],
  );

  return {
    selected,
    promotion,
    targets,
    message,
    setMessage,
    clearSelection,
    confirm,
    beginCommit,
    handleEscape,
  };
}
