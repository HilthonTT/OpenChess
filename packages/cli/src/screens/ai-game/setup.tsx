import { useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { opposite } from "@openchess/shared";
import type { Color, Difficulty, GameStatus } from "@openchess/shared";
import { GameScreen } from "../../components/game-screen";
import { describeStatus } from "../../components/game-panels";
import { useUITheme } from "../../providers/theme";
import {
  useKeyboardLayer,
  BASE_LAYER_ID,
} from "../../providers/keyboard-layer";

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export function clamp(value: number): number {
  return Math.max(0, Math.min(7, value));
}

/** The status line reworded for a human-versus-engine game. */
export function describeAiStatus(
  status: GameStatus,
  turn: Color,
  human: Color,
): string {
  switch (status) {
    case "checkmate":
      return opposite(turn) === human
        ? "Checkmate — you win!"
        : "Checkmate — the engine wins";
    case "check":
      return turn === human ? "Your move — check!" : "Check!";
    case "playing":
      return turn === human ? "Your move" : "Engine to move";
    default:
      return describeStatus(status, turn);
  }
}

/** Two quick questions — difficulty, then color — before the board appears. */
export function Setup({
  difficulty,
  onDifficulty,
  onColor,
  subtitle = "Test your skill against the engine",
}: {
  difficulty: Difficulty | null;
  onDifficulty: (difficulty: Difficulty | null) => void;
  onColor: (color: Color) => void;
  subtitle?: string;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    if (difficulty === null) {
      switch (key.name) {
        case "1":
          onDifficulty("easy");
          break;
        case "2":
          onDifficulty("medium");
          break;
        case "3":
          onDifficulty("hard");
          break;
      }
      return;
    }

    switch (key.name) {
      case "w":
        onColor("w");
        break;
      case "b":
        onColor("b");
        break;
      case "r":
        onColor(Math.random() < 0.5 ? "w" : "b");
        break;
    }
  });

  /** Escape steps back to the difficulty question before leaving the screen. */
  const handleEscape = useCallback(() => {
    if (difficulty !== null) {
      onDifficulty(null);
      return true;
    }
    return false;
  }, [difficulty, onDifficulty]);

  return (
    <GameScreen title="Play vs AI" subtitle={subtitle} onEscape={handleEscape}>
      {difficulty === null ? (
        <box flexDirection="column" alignItems="center" gap={1}>
          <text fg={theme.walnut}>Choose a difficulty</text>
          <text>
            <span fg={theme.cream}>1</span>
            <span fg={theme.faint}> Easy </span>
            <span fg={theme.cream}>2</span>
            <span fg={theme.faint}> Medium </span>
            <span fg={theme.cream}>3</span>
            <span fg={theme.faint}> Hard</span>
          </text>
        </box>
      ) : (
        <box flexDirection="column" alignItems="center" gap={1}>
          <text>
            <span fg={theme.faint}>Difficulty: </span>
            <span fg={theme.gold}>{DIFFICULTY_LABELS[difficulty]}</span>
          </text>
          <text fg={theme.walnut}>Choose your side</text>
          <text>
            <span fg={theme.cream}>w</span>
            <span fg={theme.faint}> White </span>
            <span fg={theme.cream}>b</span>
            <span fg={theme.faint}> Black </span>
            <span fg={theme.cream}>r</span>
            <span fg={theme.faint}> Random</span>
          </text>
        </box>
      )}
    </GameScreen>
  );
}
