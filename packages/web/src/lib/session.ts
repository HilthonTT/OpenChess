import {
  PERSONALITIES,
  STARTING_FEN,
  TIME_CONTROLS,
  createGame,
  isGameOver,
  isPiece,
  opposite,
  pieceColor,
  play,
  playUci,
  toUci,
  undo,
  type Color,
  type Game,
  type Move,
  type PersonalityId,
  type PgnResult,
  type TimeControlKey,
} from "@openchess/shared";

export type Mode = "local" | "ai";

export type Config = {
  mode: Mode;
  personality: PersonalityId;
  /** In a game against the computer, the side the person plays. */
  human: Color;
  startFen: string;
  variant: "standard" | "chess960";
  time: TimeControlKey | "none";
};

export type Ending = {
  result: PgnResult;
  reason: string;
};

export type Clocks = Record<Color, number>;

export type Session = {
  /** Changes on every new game so stale engine replies can be told apart. */
  id: number;
  config: Config;
  game: Game;
  clocks: Clocks | null;
  /** When the side to move started thinking; null until the first move. */
  turnStartedAt: number | null;
  /** An ending the board cannot see: resignation, a flag, an agreed draw. */
  ending: Ending | null;
};

export const DEFAULT_CONFIG: Config = {
  mode: "ai",
  personality: "tactician",
  human: "w",
  startFen: STARTING_FEN,
  variant: "standard",
  time: "none",
};

export function newSession(config: Config, game?: Game): Session {
  const clocks =
    config.time === "none"
      ? null
      : {
          w: TIME_CONTROLS[config.time].initialSeconds * 1000,
          b: TIME_CONTROLS[config.time].initialSeconds * 1000,
        };
  return {
    id: Date.now(),
    config,
    game: game ?? createGame(config.startFen),
    clocks,
    turnStartedAt: null,
    ending: null,
  };
}

export function playerName(config: Config, color: Color): string {
  if (config.mode === "local") {
    return color === "w" ? "White" : "Black";
  }
  return color === config.human
    ? "You"
    : PERSONALITIES[config.personality].name;
}

export function isComputerTurn(session: Session): boolean {
  return (
    session.config.mode === "ai" &&
    session.game.position.turn !== session.config.human &&
    endingOf(session) === null
  );
}

/** Whether the side has anything left that could ever deliver mate. */
function canMate(game: Game, color: Color): boolean {
  let minors = 0;
  for (const square of game.position.board) {
    if (!isPiece(square) || pieceColor(square) !== color) {
      continue;
    }
    const type = square.toLowerCase();
    if (type === "p" || type === "q" || type === "r") {
      return true;
    }
    if (type === "n" || type === "b") {
      minors += 1;
    }
  }
  return minors > 0;
}

export function endingOf(session: Session): Ending | null {
  if (session.ending) {
    return session.ending;
  }
  const { status, position } = session.game;
  switch (status) {
    case "checkmate":
      return {
        result: position.turn === "w" ? "0-1" : "1-0",
        reason: "Checkmate",
      };
    case "stalemate":
      return { result: "1/2-1/2", reason: "Stalemate" };
    case "draw-repetition":
      return { result: "1/2-1/2", reason: "Threefold repetition" };
    case "draw-fifty-move":
      return { result: "1/2-1/2", reason: "Fifty-move rule" };
    case "draw-insufficient-material":
      return { result: "1/2-1/2", reason: "Insufficient material" };
    default:
      return null;
  }
}

export function remaining(session: Session, color: Color, now: number) {
  if (!session.clocks) {
    return null;
  }
  const base = session.clocks[color];
  const running =
    session.turnStartedAt !== null &&
    session.game.position.turn === color &&
    endingOf(session) === null;
  return running
    ? base - Math.max(0, now - (session.turnStartedAt ?? now))
    : base;
}

/** Flags the side to move if its time has run out. */
export function checkFlag(session: Session, now: number): Session {
  const turn = session.game.position.turn;
  const left = remaining(session, turn, now);
  if (left === null || left > 0 || endingOf(session) !== null) {
    return session;
  }
  const winner = opposite(turn);
  const clocks = { ...session.clocks!, [turn]: 0 };
  const ending: Ending = canMate(session.game, winner)
    ? { result: winner === "w" ? "1-0" : "0-1", reason: "Time out" }
    : { result: "1/2-1/2", reason: "Time out vs insufficient material" };
  return { ...session, clocks, turnStartedAt: null, ending };
}

export function applyMove(session: Session, move: Move, now: number): Session {
  const flagged = checkFlag(session, now);
  if (flagged !== session) {
    return flagged;
  }

  const mover = session.game.position.turn;
  const game = play(session.game, move);
  let clocks = session.clocks;

  if (clocks) {
    const spent =
      session.turnStartedAt === null ? 0 : now - session.turnStartedAt;
    const increment =
      session.config.time === "none"
        ? 0
        : TIME_CONTROLS[session.config.time].incrementSeconds * 1000;
    clocks = { ...clocks, [mover]: clocks[mover] - spent + increment };
  }

  return {
    ...session,
    game,
    clocks,
    turnStartedAt: isGameOver(game.status) ? null : now,
  };
}

export function takeBack(session: Session, now: number): Session {
  if (session.game.history.length === 0) {
    return session;
  }
  let game = undo(session.game);
  // Against the computer, step back to a position where it is your move.
  if (session.config.mode === "ai") {
    while (
      game.history.length > 0 &&
      game.position.turn !== session.config.human
    ) {
      game = undo(game);
    }
  }
  return {
    ...session,
    game,
    turnStartedAt: session.clocks && game.history.length > 0 ? now : null,
    ending: null,
  };
}

const STORAGE_KEY = "openchess:web:session";

type Saved = {
  config: Config;
  moves: string[];
  clocks: Clocks | null;
  ending: Ending | null;
};

export function save(session: Session) {
  const saved: Saved = {
    config: session.config,
    moves: session.game.history.map((entry) => toUci(entry.move)),
    clocks: session.clocks,
    ending: session.ending,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage can be full or blocked; the game simply won't survive a reload.
  }
}

export function load(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const saved = JSON.parse(raw) as Saved;
    const config = { ...DEFAULT_CONFIG, ...saved.config };
    let game = createGame(config.startFen);
    for (const uci of saved.moves) {
      game = playUci(game, uci);
    }
    const session = newSession(config, game);
    // The clock was paused while the tab was closed; it resumes now.
    return {
      ...session,
      clocks: saved.clocks ?? session.clocks,
      ending: saved.ending,
      turnStartedAt:
        session.clocks && game.history.length > 0 && !saved.ending
          ? Date.now()
          : null,
    };
  } catch {
    return null;
  }
}
