import { useCallback, useState } from "react";
import {
  findLegalMove,
  isPiece,
  movesFromSquare,
  needsPromotion,
  pieceAt,
  pieceColor,
  premoveNeedsPromotion,
  premoveTargets,
  resolvePremove,
} from "@openchess/shared";
import type {
  Color,
  Game,
  Move,
  Premove,
  PromotionPiece,
} from "@openchess/shared";
import { colorName } from "../components/game-panels";
import {
  TYPED_MOVE_EXAMPLE,
  parseCoordinates,
  resolveTypedMove,
} from "../lib/typed-move";

export interface PendingPromotion {
  from: number;
  to: number;
  isPremove: boolean;
}

export function entryPrompt(entry: string): string {
  return entry === ""
    ? `Move › _   type ${TYPED_MOVE_EXAMPLE}, then enter`
    : `Move › ${entry}_`;
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
  allowPremove = false,
}: {
  game: Game;
  cursor: number;
  over: boolean;
  overMessage: string;
  you?: { color: Color; waitMessage: string };
  locked?: boolean;
  allowPremove?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [promotion, setPromotion] = useState<PendingPromotion | null>(null);
  const [premove, setPremove] = useState<Premove | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [entry, setEntry] = useState<string | null>(null);

  const { position } = game;

  const yourColor = you?.color ?? position.turn;
  const waiting =
    you !== undefined && (locked || position.turn !== you.color) && !over;
  const premoving = allowPremove && you !== undefined && waiting;

  const optionsFrom = useCallback(
    (square: number): Move[] =>
      premoving
        ? premoveTargets(position, square, yourColor)
        : movesFromSquare(game, square),
    [game, position, premoving, yourColor],
  );

  const targets = selected === null ? [] : optionsFrom(selected);

  const clearSelection = useCallback(() => {
    setSelected(null);
    setPromotion(null);
  }, []);

  const clearPremove = useCallback(() => {
    setPremove(null);
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

      if (optionsFrom(square).length === 0) {
        setMessage(
          premoving
            ? "That piece has nowhere to go"
            : "That piece has no legal moves",
        );
        return;
      }

      setSelected(square);
      setMessage(null);
    },
    [optionsFrom, position, premoving, you],
  );

  const queue = useCallback(
    (from: number, to: number, choice?: PromotionPiece) => {
      setPremove({ from, to, promotion: choice ?? null });
      setSelected(null);
      setPromotion(null);
      setMessage(null);
    },
    [],
  );

  const confirm = useCallback(
    (commit: CommitMove, at: number = cursor) => {
      if (over) {
        setMessage(overMessage);
        return;
      }

      if (premoving) {
        if (selected === null) {
          select(at);
          return;
        }

        if (at === selected) {
          setSelected(null);
          return;
        }

        if (premoveNeedsPromotion(position, selected, at, yourColor)) {
          setPromotion({ from: selected, to: at, isPremove: true });
          return;
        }

        if (optionsFrom(selected).some((move) => move.to === at)) {
          queue(selected, at);
          return;
        }

        select(at);
        return;
      }

      if (locked) {
        return;
      }

      if (you !== undefined && position.turn !== you.color) {
        setMessage(you.waitMessage);
        return;
      }

      if (selected === null) {
        select(at);
        return;
      }

      if (at === selected) {
        setSelected(null);
        return;
      }

      if (needsPromotion(game, selected, at)) {
        setPromotion({ from: selected, to: at, isPremove: false });
        return;
      }

      if (findLegalMove(game, selected, at)) {
        void commit(selected, at);
        return;
      }

      select(at);
    },
    [
      cursor,
      game,
      locked,
      optionsFrom,
      over,
      overMessage,
      position,
      premoving,
      queue,
      select,
      selected,
      you,
      yourColor,
    ],
  );

  const openEntry = useCallback(() => {
    setEntry("");
    setSelected(null);
    setMessage(null);
  }, []);

  const typeEntry = useCallback((text: string) => {
    setEntry((current) => (current ?? "") + text);
  }, []);

  const eraseEntry = useCallback(() => {
    setEntry((current) => (current ? current.slice(0, -1) : current));
  }, []);

  const playTyped = useCallback(
    (commit: CommitMove) => {
      const text = entry ?? "";
      setEntry(null);

      if (over) {
        setMessage(overMessage);
        return;
      }

      if (premoving) {
        const typed = parseCoordinates(text);
        if (!typed) {
          setMessage("Type a premove as two squares, like e7e5");
          return;
        }

        if (!optionsFrom(typed.from).some((move) => move.to === typed.to)) {
          setMessage("That premove can't be queued");
          return;
        }

        if (
          typed.promotion === undefined &&
          premoveNeedsPromotion(position, typed.from, typed.to, yourColor)
        ) {
          setSelected(typed.from);
          setPromotion({ from: typed.from, to: typed.to, isPremove: true });
          return;
        }

        queue(typed.from, typed.to, typed.promotion);
        return;
      }

      if (locked) {
        return;
      }

      if (you !== undefined && position.turn !== you.color) {
        setMessage(you.waitMessage);
        return;
      }

      const result = resolveTypedMove(game, text);
      if (result.kind === "error") {
        setMessage(result.message);
        return;
      }

      const { from, to, promotion } = result.move;
      if (promotion === undefined && needsPromotion(game, from, to)) {
        setSelected(from);
        setPromotion({ from, to, isPremove: false });
        return;
      }

      void commit(from, to, promotion);
    },
    [
      entry,
      game,
      locked,
      optionsFrom,
      over,
      overMessage,
      position,
      premoving,
      queue,
      you,
      yourColor,
    ],
  );

  const choosePromotion = useCallback(
    (commit: CommitMove, choice: PromotionPiece) => {
      if (promotion === null) {
        return;
      }

      if (promotion.isPremove) {
        queue(promotion.from, promotion.to, choice);
        return;
      }

      void commit(promotion.from, promotion.to, choice);
    },
    [promotion, queue],
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

  const runPremove = useCallback(
    (commit: CommitMove) => {
      if (premove === null || waiting || over) {
        return;
      }

      setPremove(null);

      if (!resolvePremove(game, premove)) {
        setMessage("Premove dropped — it isn't legal here");
        return;
      }

      void commit(premove.from, premove.to, premove.promotion ?? undefined);
    },
    [game, over, premove, waiting],
  );

  const handleEscape = useCallback(
    (cancelDialog?: () => boolean) => {
      if (entry !== null) {
        setEntry(null);
        return true;
      }

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

      if (premove !== null) {
        setPremove(null);
        setMessage("Premove cancelled");
        return true;
      }

      return false;
    },
    [entry, premove, promotion, selected],
  );

  return {
    selected,
    promotion,
    premove,
    targets,
    message: entry === null ? message : entryPrompt(entry),
    entry,
    openEntry,
    typeEntry,
    eraseEntry,
    playTyped,
    setMessage,
    clearSelection,
    clearPremove,
    confirm,
    choosePromotion,
    beginCommit,
    runPremove,
    handleEscape,
  };
}
