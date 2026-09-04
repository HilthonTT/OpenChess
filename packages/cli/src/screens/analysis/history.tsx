import { useCallback, useEffect, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { PERSONALITIES } from "@openchess/shared";
import type { PersonalityId } from "@openchess/shared";
import { ErrorNotice } from "../../components/error-notice";
import { GameScreen } from "../../components/game-screen";
import { HintBar } from "../../components/hint-bar";
import { listFinishedGames, type GameHistoryEntry } from "../../lib/games";
import { exportGamePgn } from "../../lib/pgn-files";
import {
  useKeyboardLayer,
  BASE_LAYER_ID,
} from "../../providers/keyboard-layer";
import { useKeymap } from "../../providers/keymap";
import { useUITheme } from "../../providers/theme";
import { errorMessage } from "../../lib/utils";

import { HISTORY_KEYMAP, SUBTITLE, TITLE, WIDTH } from "./keymaps";

export function History({
  onOpen,
  onImport,
}: {
  onOpen: (gameId: string) => void;
  onImport: () => void;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  useKeymap(HISTORY_KEYMAP);

  const [games, setGames] = useState<GameHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    void listFinishedGames()
      .then((page) => {
        if (!cancelled) {
          setGames(page.games);
          setCursor(page.nextCursor);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(errorMessage(cause));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const loadingMore = useRef(false);
  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore.current) {
      return;
    }
    loadingMore.current = true;
    void listFinishedGames({ cursor })
      .then((page) => {
        setGames((prev) => [...(prev ?? []), ...page.games]);
        setCursor(page.nextCursor);
      })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => {
        loadingMore.current = false;
      });
  }, [cursor]);

  const exportSelected = useCallback(async () => {
    const game = games?.[index];
    if (!game) {
      return;
    }

    setNote("Exporting…");
    try {
      const { path } = await exportGamePgn(game.id);
      setNote(`Saved to ${path}`);
    } catch (cause) {
      setNote(errorMessage(cause));
    }
  }, [games, index]);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || !games) {
      return;
    }

    switch (key.name) {
      case "up":
      case "k":
        setIndex((value) => Math.max(0, value - 1));
        break;
      case "down":
      case "j": {
        const next = Math.min(games.length - 1, index + 1);
        setIndex(next);
        if (next >= games.length - 2) {
          loadMore();
        }
        break;
      }
      case "return":
      case "space": {
        const game = games[index];
        if (game) {
          onOpen(game.id);
        }
        break;
      }
      case "e":
        void exportSelected();
        break;
      case "i":
        onImport();
        break;
      case "r":
        setIndex(0);
        setNote(null);
        setAttempt((value) => value + 1);
        break;
    }
  });

  return (
    <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
      {error ? (
        <ErrorNotice title="Couldn't load your games" message={error} />
      ) : !games ? (
        <text fg={theme.dim}>Loading…</text>
      ) : games.length === 0 ? (
        <text fg={theme.dim}>
          No finished games yet — play one, then come back to review it.
        </text>
      ) : (
        <HistoryTable games={games} index={index} />
      )}

      {note ? <text fg={theme.gold}>{note}</text> : null}

      <HintBar
        hints={[
          { key: "↑↓", label: "browse" },
          { key: "enter", label: "review" },
          { key: "e", label: "export PGN" },
          { key: "i", label: "import" },
          { key: "r", label: "refresh" },
        ]}
      />
    </GameScreen>
  );
}

const WHEN_W = 12;

const KIND_W = 18;

const RESULT_W = 12;

function historyResult(entry: GameHistoryEntry): string {
  if (entry.result === null) {
    return "Unfinished";
  }
  if (entry.result === "DRAW") {
    return "Draw";
  }
  if (entry.result === "ABORTED") {
    return "Aborted";
  }
  const youWon = (entry.result === "WHITE_WIN") === (entry.yourColor === "w");
  return youWon ? "Won" : "Lost";
}

function historyKind(entry: GameHistoryEntry): string {
  const rules = entry.variant === "CHESS960" ? " · 960" : "";

  if (entry.mode === "AI") {
    return `vs ${botName(entry.personality)}${rules}`;
  }
  return `Online 1v1${rules}`;
}

export function botName(personality: PersonalityId | null): string {
  return personality ? PERSONALITIES[personality].name : "Engine";
}

function HistoryTable({
  games,
  index,
}: {
  games: GameHistoryEntry[];
  index: number;
}) {
  const theme = useUITheme();

  return (
    <box flexDirection="column" width={WIDTH - 6}>
      <text>
        <span fg={theme.faint}>{"When".padEnd(WHEN_W)}</span>
        <span fg={theme.faint}>{"Game".padEnd(KIND_W)}</span>
        <span fg={theme.faint}>{"Result".padEnd(RESULT_W)}</span>
        <span fg={theme.faint}>Moves</span>
      </text>

      {games.map((entry, i) => {
        const active = i === index;
        const fg = active ? theme.cream : theme.text;
        const when = entry.endedAt
          ? new Date(entry.endedAt).toLocaleDateString()
          : "—";
        const moves = Math.ceil(entry.ply / 2);

        return (
          <text key={entry.id} bg={active ? theme.selectionBg : undefined}>
            <span fg={active ? theme.gold : theme.faint}>
              {active ? "▸ " : "  "}
            </span>
            <span fg={theme.dim}>{when.padEnd(WHEN_W - 2)}</span>
            <span fg={fg}>{historyKind(entry).padEnd(KIND_W)}</span>
            <span fg={fg}>{historyResult(entry).padEnd(RESULT_W)}</span>
            <span fg={theme.dim}>{String(moves)}</span>
          </text>
        );
      })}
    </box>
  );
}
