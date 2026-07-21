import { useCallback, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { opposite, TIME_CONTROLS } from "@openchess/shared";
import type {
  Color,
  Difficulty,
  GameStatus,
  TimeControlKey,
} from "@openchess/shared";
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

/** Everything the setup collects before a board appears. */
export type SetupChoice = {
  difficulty: Difficulty;
  color: Color;
  /** Null when the player picked an untimed game, or was never asked. */
  timeControl: TimeControlKey | null;
};

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

type Step = "difficulty" | "time" | "color";

/**
 * The quick questions before the board appears — difficulty, then an optional
 * time control, then colour. `askTimeControl` is off for the offline engine
 * (nothing there to clock) and on for server games, which the clock is enforced
 * on. Colour is always last, since choosing it is what starts the game.
 */
export function Setup({
  onStart,
  askTimeControl = false,
  subtitle = "Test your skill against the engine",
}: {
  onStart: (choice: SetupChoice) => void;
  askTimeControl?: boolean;
  subtitle?: string;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  // `undefined` means "not chosen yet"; `null` means the player picked untimed.
  const [timeControl, setTimeControl] = useState<
    TimeControlKey | null | undefined
  >(undefined);

  const step: Step =
    difficulty === null
      ? "difficulty"
      : askTimeControl && timeControl === undefined
        ? "time"
        : "color";

  const start = useCallback(
    (color: Color) => {
      if (difficulty === null) {
        return;
      }
      onStart({
        difficulty,
        color,
        timeControl: askTimeControl ? (timeControl ?? null) : null,
      });
    },
    [askTimeControl, difficulty, onStart, timeControl],
  );

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    if (step === "difficulty") {
      switch (key.name) {
        case "1":
          setDifficulty("easy");
          break;
        case "2":
          setDifficulty("medium");
          break;
        case "3":
          setDifficulty("hard");
          break;
      }
      return;
    }

    if (step === "time") {
      switch (key.name) {
        case "1":
          setTimeControl(null);
          break;
        case "2":
          setTimeControl("bullet");
          break;
        case "3":
          setTimeControl("blitz");
          break;
        case "4":
          setTimeControl("rapid");
          break;
      }
      return;
    }

    switch (key.name) {
      case "w":
        start("w");
        break;
      case "b":
        start("b");
        break;
      case "r":
        start(Math.random() < 0.5 ? "w" : "b");
        break;
    }
  });

  /** Escape unwinds one question at a time before it gives up the screen. */
  const handleEscape = useCallback(() => {
    if (step === "color") {
      if (askTimeControl) {
        setTimeControl(undefined);
      } else {
        setDifficulty(null);
      }
      return true;
    }
    if (step === "time") {
      setDifficulty(null);
      return true;
    }
    return false;
  }, [askTimeControl, step]);

  const chosenTimeControlLabel =
    timeControl == null ? "Untimed" : TIME_CONTROLS[timeControl].label;

  return (
    <GameScreen title="Play vs AI" subtitle={subtitle} onEscape={handleEscape}>
      {step === "difficulty" ? (
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
      ) : step === "time" ? (
        <box flexDirection="column" alignItems="center" gap={1}>
          <text>
            <span fg={theme.faint}>Difficulty: </span>
            <span fg={theme.gold}>{DIFFICULTY_LABELS[difficulty!]}</span>
          </text>
          <text fg={theme.walnut}>Choose a time control</text>
          <text>
            <span fg={theme.cream}>1</span>
            <span fg={theme.faint}> Untimed </span>
            <span fg={theme.cream}>2</span>
            <span fg={theme.faint}> {TIME_CONTROLS.bullet.label} </span>
            <span fg={theme.cream}>3</span>
            <span fg={theme.faint}> {TIME_CONTROLS.blitz.label} </span>
            <span fg={theme.cream}>4</span>
            <span fg={theme.faint}> {TIME_CONTROLS.rapid.label}</span>
          </text>
        </box>
      ) : (
        <box flexDirection="column" alignItems="center" gap={1}>
          <text>
            <span fg={theme.faint}>Difficulty: </span>
            <span fg={theme.gold}>{DIFFICULTY_LABELS[difficulty!]}</span>
            {askTimeControl ? (
              <>
                <span fg={theme.faint}> · Clock: </span>
                <span fg={theme.gold}>{chosenTimeControlLabel}</span>
              </>
            ) : null}
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
