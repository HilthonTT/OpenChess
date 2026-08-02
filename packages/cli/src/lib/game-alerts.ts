import type { Color } from "@openchess/shared";

/**
 * Which changes to an online game are worth ringing the terminal for.
 *
 * Kept apart from the screen because it is a policy rather than a rendering:
 * the interesting part is everything it declines to ring for, and that is only
 * worth having if it can be stated as a table and tested as one.
 */

/**
 * How long the opponent has to have been thinking before their move is worth a
 * bell.
 *
 * The bell exists for the moment you notice something happened while you were
 * not looking, and a reply that came back in four seconds is not that moment:
 * nobody wandered off during it, and one beep a move in a bullet game is not
 * attention, it is noise. Twenty seconds is long enough that no bullet game
 * ever rings and short enough that a rapid or untimed game — the ones people
 * actually leave a terminal in the middle of — rings whenever it should.
 */
export const QUIET_REPLY_MS = 20_000;

/** As much of a game as deciding this takes. */
export type AlertGame = {
  /** Whose move it is now. */
  turn: Color;
  /** Half-moves played, which is how a move is told from everything else. */
  ply: number;
  result: "WHITE_WIN" | "BLACK_WIN" | "DRAW" | "ABORTED" | null;
  drawOfferFrom: Color | null;
  /** The moves in SAN, so the newest can be named in the notification. */
  history: string[];
};

export type AlertInput = {
  /** The state that just arrived. */
  state: AlertGame;
  /** What the board was showing before it. */
  previous: AlertGame;
  /** The colour we are playing. */
  you: Color;
  /** What to call the other player. */
  opponent: string;
  /**
   * When the opponent's turn began by this client's clock, or null while it is
   * ours. Not read off the game's own clock deliberately — an untimed game has
   * none, and the question here is how long *this terminal* has been sitting
   * there with nothing happening in it.
   */
  theirTurnSince: number | null;
  /** Now. Passed in so the rule can be tested without waiting for it. */
  now: number;
  /**
   * One of our own requests is in flight. A change arriving underneath it is
   * most likely its echo — the live stream sometimes beats the response to the
   * move, resignation or draw that caused it, and our own resignation is not
   * news worth a bell.
   */
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

  // Why it ended is not on the wire — a resignation, a checkmate and a fallen
  // flag all arrive as the same field — so the line says the part that is
  // knowable, and the board is still there to say the rest.
  return (result === "WHITE_WIN") === (you === "w")
    ? `You beat ${opponent}`
    : `${opponent} beat you`;
}

/**
 * What the terminal should be rung about, or null for the far more common case
 * of a change nobody needs to be fetched back to the keyboard for.
 */
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

  // The end of the game outranks whatever else changed alongside it: a move
  // that was also a checkmate is worth one notification, and it is this one.
  if (state.result !== null) {
    return previous.result === null
      ? endOfGame(state.result, you, opponent)
      : null;
  }

  if (state.ply !== previous.ply) {
    // Our own move comes back through here whenever the stream beats the
    // response to it. It left the opponent to move, which is how it is told
    // apart from theirs.
    if (state.turn !== you) {
      return null;
    }

    if (theirTurnSince !== null && now - theirTurnSince < QUIET_REPLY_MS) {
      return null;
    }

    const move = state.history.at(-1);

    return move ? `${opponent} played ${move} — your move` : "Your move";
  }

  // A draw offer moves neither the ply nor the result, so it would fall through
  // everything above. It is also the one change that is a question addressed to
  // this player, and it rings however quickly it arrived: the game is waiting on
  // an answer that only this terminal can give.
  if (
    state.drawOfferFrom !== previous.drawOfferFrom &&
    state.drawOfferFrom !== null &&
    state.drawOfferFrom !== you
  ) {
    return `${opponent} offers a draw`;
  }

  return null;
}
