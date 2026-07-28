import { useCallback, useState } from "react";
import { useKeyboard } from "@opentui/react";
import {
  opposite,
  PERSONALITIES,
  PERSONALITY_ORDER,
  TIME_CONTROLS,
} from "@openchess/shared";
import type {
  Color,
  GameStatus,
  Personality,
  PersonalityId,
  TimeControlKey,
} from "@openchess/shared";
import { GameScreen } from "../../components/game-screen";
import { describeStatus } from "../../components/game-panels";
import { useUITheme } from "../../providers/theme";
import {
  useKeyboardLayer,
  BASE_LAYER_ID,
} from "../../providers/keyboard-layer";

/** Which rules to play under. Mirrors the server's `GameVariant`. */
export type Variant = "STANDARD" | "CHESS960";

/** Everything the setup collects before a board appears. */
export type SetupChoice = {
  personality: PersonalityId;
  color: Color;
  /** Null when the player picked an untimed game, or was never asked. */
  timeControl: TimeControlKey | null;
  variant: Variant;
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

type Step = "opponent" | "variant" | "time" | "color";

/** The keys the opponent list is picked with: 1..6, in catalog order. */
const OPPONENT_KEYS = PERSONALITY_ORDER.map((_, index) => String(index + 1));

/**
 * The quick questions before the board appears — who to play, then the rules,
 * then an optional time control, then colour.
 *
 * `askTimeControl` is off for the offline engine (nothing there to clock) and
 * on for server games, which the clock is enforced on. Colour is always last,
 * since choosing it is what starts the game.
 */
export function Setup({
  onStart,
  askTimeControl = false,
  askVariant = true,
  subtitle = "Test your skill against the engine",
}: {
  onStart: (choice: SetupChoice) => void;
  askTimeControl?: boolean;
  askVariant?: boolean;
  subtitle?: string;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  const [personality, setPersonality] = useState<PersonalityId | null>(null);
  const [variant, setVariant] = useState<Variant | undefined>(undefined);
  // `undefined` means "not chosen yet"; `null` means the player picked untimed.
  const [timeControl, setTimeControl] = useState<
    TimeControlKey | null | undefined
  >(undefined);

  const step: Step =
    personality === null
      ? "opponent"
      : askVariant && variant === undefined
        ? "variant"
        : askTimeControl && timeControl === undefined
          ? "time"
          : "color";

  const start = useCallback(
    (color: Color) => {
      if (personality === null) {
        return;
      }
      onStart({
        personality,
        color,
        timeControl: askTimeControl ? (timeControl ?? null) : null,
        variant: askVariant ? (variant ?? "STANDARD") : "STANDARD",
      });
    },
    [askTimeControl, askVariant, onStart, personality, timeControl, variant],
  );

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    if (step === "opponent") {
      const index = OPPONENT_KEYS.indexOf(key.name ?? "");
      if (index >= 0) {
        setPersonality(PERSONALITY_ORDER[index]!);
      }
      return;
    }

    if (step === "variant") {
      switch (key.name) {
        case "1":
          setVariant("STANDARD");
          break;
        case "2":
          setVariant("CHESS960");
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
      } else if (askVariant) {
        setVariant(undefined);
      } else {
        setPersonality(null);
      }
      return true;
    }
    if (step === "time") {
      if (askVariant) {
        setVariant(undefined);
      } else {
        setPersonality(null);
      }
      return true;
    }
    if (step === "variant") {
      setPersonality(null);
      return true;
    }
    return false;
  }, [askTimeControl, askVariant, step]);

  const chosen = personality ? PERSONALITIES[personality] : null;
  const chosenTimeControlLabel =
    timeControl == null ? "Untimed" : TIME_CONTROLS[timeControl].label;

  return (
    <GameScreen title="Play vs AI" subtitle={subtitle} onEscape={handleEscape}>
      {step === "opponent" ? (
        <box flexDirection="column" alignItems="center" gap={1}>
          <text fg={theme.walnut}>Choose your opponent</text>
          <box flexDirection="column" gap={0}>
            {PERSONALITY_ORDER.map((id, index) => (
              <OpponentRow
                key={id}
                shortcut={OPPONENT_KEYS[index]!}
                personality={PERSONALITIES[id]}
              />
            ))}
          </box>
        </box>
      ) : step === "variant" ? (
        <box flexDirection="column" alignItems="center" gap={1}>
          <ChoiceSoFar
            personality={chosen}
            variant={undefined}
            timeControl={undefined}
            askTimeControl={askTimeControl}
          />
          <text fg={theme.walnut}>Choose the rules</text>
          <text>
            <span fg={theme.cream}>1</span>
            <span fg={theme.faint}> Standard </span>
            <span fg={theme.cream}>2</span>
            <span fg={theme.faint}> Chess960</span>
          </text>
          <text fg={theme.dim}>
            Chess960 shuffles the back rank. Same rules, no theory.
          </text>
        </box>
      ) : step === "time" ? (
        <box flexDirection="column" alignItems="center" gap={1}>
          <ChoiceSoFar
            personality={chosen}
            variant={askVariant ? variant : undefined}
            timeControl={undefined}
            askTimeControl={askTimeControl}
          />
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
          <ChoiceSoFar
            personality={chosen}
            variant={askVariant ? variant : undefined}
            timeControl={askTimeControl ? chosenTimeControlLabel : undefined}
            askTimeControl={askTimeControl}
          />
          {chosen ? <text fg={theme.dim}>{chosen.blurb}</text> : null}
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

/** One line of the opponent list: key, name, strength, and what it wants. */
function OpponentRow({
  shortcut,
  personality,
}: {
  shortcut: string;
  personality: Personality;
}) {
  const theme = useUITheme();

  return (
    <text>
      <span fg={theme.cream}>{shortcut}</span>
      <span fg={theme.faint}> </span>
      <span fg={theme.gold}>{personality.name.padEnd(11)}</span>
      <span fg={theme.walnut}>{`~${personality.elo}`.padEnd(7)}</span>
      <span fg={theme.faint}>{personality.blurb}</span>
    </text>
  );
}

/** The header line recapping what has been picked so far. */
function ChoiceSoFar({
  personality,
  variant,
  timeControl,
  askTimeControl,
}: {
  personality: Personality | null;
  variant: Variant | undefined;
  timeControl: string | undefined;
  askTimeControl: boolean;
}) {
  const theme = useUITheme();

  if (!personality) {
    return null;
  }

  return (
    <text>
      <span fg={theme.faint}>Opponent: </span>
      <span fg={theme.gold}>{personality.name}</span>
      <span fg={theme.faint}>{` (~${personality.elo})`}</span>
      {variant !== undefined ? (
        <>
          <span fg={theme.faint}> · Rules: </span>
          <span fg={theme.gold}>
            {variant === "CHESS960" ? "Chess960" : "Standard"}
          </span>
        </>
      ) : null}
      {askTimeControl && timeControl !== undefined ? (
        <>
          <span fg={theme.faint}> · Clock: </span>
          <span fg={theme.gold}>{timeControl}</span>
        </>
      ) : null}
    </text>
  );
}
