"use client";

import {
  capturedPieces,
  findKing,
  findLegalMove,
  findUciMove,
  formatClock,
  isInCheck,
  materialBalance,
  movePairs,
  needsPromotion,
  openingOf,
  randomChess960Fen,
  toFen,
  toPgn,
  type Color,
  type Game,
  type Piece as PieceCode,
  type PromotionPiece,
} from "@openchess/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CONFIG,
  applyMove,
  checkFlag,
  endingOf,
  isComputerTurn,
  load,
  newSession,
  playerName,
  remaining,
  save,
  takeBack,
  type Config,
  type Session,
} from "@/lib/session";
import { useAi } from "@/lib/use-ai";
import { Board } from "./Board";
import { Logo } from "./Logo";
import { NewGameDialog } from "./NewGameDialog";
import { Piece } from "./Piece";

function PlayerBar({
  name,
  color,
  captured,
  advantage,
  clock,
  active,
  thinking,
}: {
  name: string;
  color: Color;
  captured: PieceCode[];
  advantage: number;
  clock: number | null;
  active: boolean;
  thinking: boolean;
}) {
  const low = clock !== null && clock < 20_000;
  return (
    <div className={`player${active ? " player-active" : ""}`}>
      <span className={`swatch swatch-${color}`} aria-hidden="true" />
      <div className="player-info">
        <span className="player-name">
          {name}
          {thinking && <span className="thinking">thinking…</span>}
        </span>
        <span className="captured">
          {captured.map((piece, index) => (
            // Captured pieces repeat and never reorder, so position is identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: stable list
            <span key={index} className="captured-piece">
              <Piece piece={piece} />
            </span>
          ))}
          {advantage > 0 && <span className="advantage">+{advantage}</span>}
        </span>
      </div>
      {clock !== null && (
        <span
          className={`clock${active ? " clock-running" : ""}${low ? " clock-low" : ""}`}
        >
          {formatClock(clock)}
        </span>
      )}
    </div>
  );
}

function resultText(result: string, config: Config): string {
  if (result === "1/2-1/2") {
    return "Draw";
  }
  const winner: Color = result === "1-0" ? "w" : "b";
  if (config.mode === "ai") {
    return winner === config.human ? "You won" : "You lost";
  }
  return winner === "w" ? "White wins" : "Black wins";
}

function today(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

export function ChessApp() {
  const [session, setSession] = useState<Session>(() =>
    newSession(DEFAULT_CONFIG),
  );
  const [ready, setReady] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<Color>("w");
  const [autoFlip, setAutoFlip] = useState(false);
  const [promotion, setPromotion] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const ai = useAi();
  const moveListRef = useRef<HTMLOListElement>(null);

  const { game, config } = session;
  const ending = endingOf(session);
  const turn = game.position.turn;

  // Restore the last game once mounted; the server render always starts fresh.
  useEffect(() => {
    const restored = load();
    if (restored) {
      setSession(restored);
      setOrientation(
        restored.config.mode === "ai" ? restored.config.human : "w",
      );
    } else {
      setDialogOpen(true);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) {
      save(session);
    }
  }, [ready, session]);

  // Tick the clocks, and flag whoever runs out.
  const clockRunning =
    session.clocks !== null && session.turnStartedAt !== null && !ending;
  useEffect(() => {
    if (!clockRunning) {
      return;
    }
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      setSession((current) => checkFlag(current, at));
    }, 100);
    return () => clearInterval(timer);
  }, [clockRunning]);

  // Let the computer move when it is its turn.
  const computerTurn = ready && isComputerTurn(session);
  const sessionId = session.id;
  const ply = game.history.length;
  // The position for a given ply of a given game never changes, so the
  // session id and ply are all this needs to re-run on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on ply
  useEffect(() => {
    if (!computerTurn) {
      setThinking(false);
      return;
    }
    let cancelled = false;
    setThinking(true);
    const started = Date.now();
    const fen = toFen(game.position);
    const history = game.history.map((entry) => toFen(entry.before));

    ai.think(fen, history, config.personality).then((uci) => {
      if (cancelled || uci === null) {
        return;
      }
      // A beat of delay so an instant reply still reads as a move being made.
      const wait = Math.max(0, 350 - (Date.now() - started));
      setTimeout(() => {
        if (cancelled) {
          return;
        }
        setSession((current) => {
          if (current.id !== sessionId || current.game.history.length !== ply) {
            return current;
          }
          const move = findUciMove(current.game, uci);
          return move ? applyMove(current, move, Date.now()) : current;
        });
        setThinking(false);
      }, wait);
    });

    return () => {
      cancelled = true;
      ai.cancel();
    };
  }, [computerTurn, sessionId, ply]);

  // Pass & play: turn the board to whoever is moving.
  useEffect(() => {
    if (autoFlip && config.mode === "local") {
      setOrientation(turn);
    }
  }, [autoFlip, config.mode, turn]);

  // Follow the newest move in the move list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run per new move
  useEffect(() => {
    if (viewPly === null && moveListRef.current) {
      moveListRef.current.scrollTop = moveListRef.current.scrollHeight;
    }
  }, [viewPly, ply]);

  const flash = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 1800);
  }, []);

  const viewing = viewPly !== null && viewPly < ply;
  const shownPly = viewing ? viewPly : ply;
  const shownPosition = viewing
    ? game.history[shownPly]!.before
    : game.position;
  const shownLast = shownPly > 0 ? game.history[shownPly - 1]!.move : null;
  const shownCheck = isInCheck(shownPosition, shownPosition.turn)
    ? findKing(shownPosition.board, shownPosition.turn)
    : null;

  const movable: Color | null =
    viewing || ending || !ready || dialogOpen
      ? null
      : config.mode === "local"
        ? turn
        : turn === config.human
          ? turn
          : null;

  function commit(from: number, to: number, piece?: PromotionPiece) {
    const move = findLegalMove(game, from, to, piece);
    if (!move) {
      return;
    }
    setSession((current) => applyMove(current, move, Date.now()));
  }

  function handleMove(from: number, to: number) {
    if (needsPromotion(game, from, to)) {
      setPromotion({ from, to });
      return;
    }
    commit(from, to);
  }

  function handlePromote(piece: PromotionPiece | null) {
    if (promotion && piece) {
      commit(promotion.from, promotion.to, piece);
    }
    setPromotion(null);
  }

  function startGame(next: Config, imported?: Game) {
    ai.cancel();
    setSession(newSession(next, imported));
    setViewPly(null);
    setPromotion(null);
    setOrientation(next.mode === "ai" ? next.human : "w");
    setDialogOpen(false);
  }

  function rematch() {
    startGame({
      ...config,
      human: config.human === "w" ? "b" : "w",
      startFen:
        config.variant === "chess960" ? randomChess960Fen() : config.startFen,
    });
  }

  function handleUndo() {
    ai.cancel();
    setPromotion(null);
    setViewPly(null);
    setSession((current) => takeBack(current, Date.now()));
  }

  function endWith(result: Session["ending"]) {
    ai.cancel();
    setSession((current) => ({
      ...current,
      ending: result,
      turnStartedAt: null,
    }));
  }

  function handleResign() {
    const loser: Color = config.mode === "ai" ? config.human : turn;
    endWith({
      result: loser === "w" ? "0-1" : "1-0",
      reason: `${loser === "w" ? "White" : "Black"} resigned`,
    });
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash(`${what} copied`);
    } catch {
      flash("Clipboard is unavailable here");
    }
  }

  function pgn() {
    return toPgn(game, {
      result: ending?.result ?? "*",
      tags: {
        event: "OpenChess local game",
        site: typeof location === "undefined" ? "OpenChess" : location.href,
        date: today(),
        white: playerName(config, "w"),
        black: playerName(config, "b"),
      },
    });
  }

  // Arrow keys step through the game, f flips, z takes back.
  const keyState = useRef({ ply, shownPly, viewing });
  keyState.current = { ply, shownPly, viewing };
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) {
        return;
      }
      const state = keyState.current;
      const go = (to: number) =>
        setViewPly(to >= state.ply ? null : Math.max(0, to));
      switch (event.key) {
        case "ArrowLeft":
          go(state.shownPly - 1);
          break;
        case "ArrowRight":
          go(state.shownPly + 1);
          break;
        case "Home":
        case "ArrowUp":
          go(0);
          break;
        case "End":
        case "ArrowDown":
          go(state.ply);
          break;
        case "f":
          setOrientation((current) => (current === "w" ? "b" : "w"));
          break;
        default:
          return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const captured = useMemo(() => capturedPieces(game), [game]);
  const balance = materialBalance(game.position);
  const opening = useMemo(() => openingOf(game), [game]);
  const pairs = movePairs(game);
  const firstIsBlack = game.history[0]?.before.turn === "b";

  const top: Color = orientation === "w" ? "b" : "w";
  const bottom: Color = orientation;
  const bar = (color: Color) => (
    <PlayerBar
      name={playerName(config, color)}
      color={color}
      captured={color === "w" ? captured.byWhite : captured.byBlack}
      advantage={color === "w" ? balance : -balance}
      clock={remaining(session, color, now)}
      active={!ending && turn === color}
      thinking={thinking && turn === color}
    />
  );

  const status = ending
    ? `${resultText(ending.result, config)} · ${ending.reason}`
    : thinking
      ? `${playerName(config, turn)} is thinking`
      : config.mode === "ai"
        ? turn === config.human
          ? game.status === "check"
            ? "Your move — you are in check"
            : "Your move"
          : "Waiting…"
        : `${turn === "w" ? "White" : "Black"} to move${game.status === "check" ? " — check" : ""}`;

  return (
    <div className="app">
      <header className="topbar">
        <Logo />
        <nav className="topbar-actions">
          <a
            className="ghost-link"
            href="https://github.com/HilthonTT/OpenChess"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <button
            type="button"
            className="primary"
            onClick={() => setDialogOpen(true)}
          >
            New game
          </button>
        </nav>
      </header>

      <main className="layout">
        <section className="board-column">
          {bar(top)}
          <div className="board-holder">
            <Board
              position={shownPosition}
              orientation={orientation}
              movable={movable}
              legalMoves={game.legalMoves}
              lastMove={shownLast}
              check={shownCheck}
              promotion={
                promotion ? { square: promotion.to, color: turn } : null
              }
              showTargets
              onMove={handleMove}
              onPromote={handlePromote}
            />
            {ending && !viewing && !dialogOpen && (
              <div className="result-card">
                <span className="result-score">
                  {ending.result.replace("1/2", "½")}
                </span>
                <strong>{resultText(ending.result, config)}</strong>
                <span className="muted">{ending.reason}</span>
                <button
                  type="button"
                  className="primary"
                  onClick={() => setDialogOpen(true)}
                >
                  Play again
                </button>
              </div>
            )}
          </div>
          {bar(bottom)}
        </section>

        <aside className="panel">
          <div className="card status-card">
            <span className={`status-dot${ending ? " done" : ""}`} />
            <div>
              <div className="status-text">{status}</div>
              <div className="muted small">
                {config.variant === "chess960" ? "Chess960 · " : ""}
                {opening
                  ? `${opening.eco} ${opening.name}`
                  : "Local game · nothing leaves this browser"}
              </div>
            </div>
          </div>

          <div className="card moves-card">
            <div className="card-head">
              <span>Moves</span>
              {viewing && (
                <button
                  type="button"
                  className="link"
                  onClick={() => setViewPly(null)}
                >
                  Back to game
                </button>
              )}
            </div>
            <ol className="moves" ref={moveListRef}>
              {pairs.length === 0 && (
                <li className="muted empty">No moves yet</li>
              )}
              {pairs.map((pair, row) => {
                const whitePly = firstIsBlack ? row * 2 - 1 : row * 2;
                const blackPly = whitePly + 1;
                const cell = (san: string | null, at: number) =>
                  san === null || san === "…" ? (
                    <span className="san" />
                  ) : (
                    <button
                      type="button"
                      className={`san${shownPly === at + 1 ? " on" : ""}`}
                      onClick={() => setViewPly(at + 1 >= ply ? null : at + 1)}
                    >
                      {san}
                    </button>
                  );
                return (
                  <li key={pair.number}>
                    <span className="num">{pair.number}.</span>
                    {cell(pair.white, whitePly)}
                    {cell(pair.black, blackPly)}
                  </li>
                );
              })}
            </ol>
            <div className="nav">
              <button
                type="button"
                onClick={() => setViewPly(0)}
                disabled={shownPly === 0}
                aria-label="First move"
              >
                ⏮
              </button>
              <button
                type="button"
                onClick={() => setViewPly(Math.max(0, shownPly - 1))}
                disabled={shownPly === 0}
                aria-label="Previous move"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={() =>
                  setViewPly(shownPly + 1 >= ply ? null : shownPly + 1)
                }
                disabled={!viewing}
                aria-label="Next move"
              >
                ▶
              </button>
              <button
                type="button"
                onClick={() => setViewPly(null)}
                disabled={!viewing}
                aria-label="Last move"
              >
                ⏭
              </button>
            </div>
          </div>

          <div className="card actions">
            <button
              type="button"
              onClick={handleUndo}
              disabled={ply === 0 || session.ending !== null}
            >
              Take back
            </button>
            <button
              type="button"
              onClick={() =>
                setOrientation((current) => (current === "w" ? "b" : "w"))
              }
            >
              Flip board
            </button>
            {config.mode === "local" ? (
              <button
                type="button"
                onClick={() =>
                  endWith({ result: "1/2-1/2", reason: "Draw agreed" })
                }
                disabled={ending !== null || ply === 0}
              >
                Agree draw
              </button>
            ) : (
              <button
                type="button"
                onClick={() => copy(toFen(shownPosition), "FEN")}
              >
                Copy FEN
              </button>
            )}
            <button
              type="button"
              className="danger"
              onClick={handleResign}
              disabled={ending !== null || ply === 0}
            >
              Resign
            </button>
            <button type="button" onClick={() => copy(pgn(), "PGN")}>
              Copy PGN
            </button>
            {config.mode === "local" ? (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={autoFlip}
                  onChange={(event) => setAutoFlip(event.target.checked)}
                />
                Auto-flip
              </label>
            ) : (
              <button type="button" onClick={rematch}>
                Rematch
              </button>
            )}
          </div>

          <p className="hint muted small">
            Drag or click to move · ← → step through moves · F flips
          </p>
        </aside>
      </main>

      {dialogOpen && (
        <NewGameDialog
          initial={config}
          canClose={ready}
          onClose={() => setDialogOpen(false)}
          onStart={startGame}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
