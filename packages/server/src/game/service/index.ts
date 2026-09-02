/**
 * The game service: the only thing in the server that is allowed to decide what
 * a position is, or what a finished game pays.
 *
 * The board is never trusted from the client. Every request rebuilds the game by
 * replaying its stored UCI moves — which is also the only way the repetition map
 * and the fifty-move clock come back correct, since a FEN cannot carry position
 * history.
 */

export {
  createAiGame,
  getGame,
  initialClockData,
  joinPvpQueue,
  leavePvpQueue,
  playMove,
  resignGame,
  abortGame,
  type MoveResult,
  type QueueResult,
} from "./play";

export { offerDraw, acceptDraw, declineDraw } from "./draws";

export { offerTakeback, acceptTakeback, declineTakeback } from "./takebacks";

export { claimVictory, flagGame } from "./activity";

export {
  getGamePgn,
  listActiveGames,
  listGames,
  listLiveGames,
  watchGame,
  type GameSummary,
  type LiveGameSummary,
  type SpectatorView,
} from "./queries";

export type {
  ClockView,
  GameView,
  MoveView,
  OpponentView,
  RewardView,
  TimeControlView,
  UnlockView,
} from "./views";
