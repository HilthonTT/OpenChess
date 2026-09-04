import type { Color } from "@openchess/shared";

export const QUIET_REPLY_MS = 20_000;

export type AlertGame = {
  turn: Color;
  ply: number;
  result: "WHITE_WIN" | "BLACK_WIN" | "DRAW" | "ABORTED" | null;
  drawOfferFrom: Color | null;
  takebackOfferFrom: Color | null;
  history: string[];
};

export type AlertInput = {
  state: AlertGame;
  previous: AlertGame;
  you: Color;
  opponent: string;
  theirTurnSince: number | null;
  now: number;
  awaitingOurOwn: boolean;
};

function endOfGame(
  result: NonNullable<AlertGame["result"]>,
  you: Color,
  opponent: string,
): string {
  if (result === "ABORTED") {
    return `${opponent} aborted your game`;
  }

  if (result === "DRAW") {
    return `Your game with ${opponent} is a draw`;
  }

  return (result === "WHITE_WIN") === (you === "w")
    ? `You beat ${opponent}`
    : `${opponent} beat you`;
}

export function alertFor({
  state,
  previous,
  you,
  opponent,
  theirTurnSince,
  now,
  awaitingOurOwn,
}: AlertInput): string | null {
  if (awaitingOurOwn) {
    return null;
  }

  if (state.result !== null) {
    return previous.result === null
      ? endOfGame(state.result, you, opponent)
      : null;
  }

  if (state.ply < previous.ply) {
    return state.turn === you
      ? `${opponent} gave you your move back`
      : `${opponent} took their move back`;
  }

  if (state.ply !== previous.ply) {
    if (state.turn !== you) {
      return null;
    }

    if (theirTurnSince !== null && now - theirTurnSince < QUIET_REPLY_MS) {
      return null;
    }

    const move = state.history.at(-1);

    return move ? `${opponent} played ${move} — your move` : "Your move";
  }

  if (
    state.drawOfferFrom !== previous.drawOfferFrom &&
    state.drawOfferFrom !== null &&
    state.drawOfferFrom !== you
  ) {
    return `${opponent} offers a draw`;
  }

  if (
    state.takebackOfferFrom !== previous.takebackOfferFrom &&
    state.takebackOfferFrom !== null &&
    state.takebackOfferFrom !== you
  ) {
    return `${opponent} asks for their move back`;
  }

  return null;
}
