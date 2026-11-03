"use client";

import {
  PERSONALITY_LIST,
  STARTING_FEN,
  TIME_CONTROLS,
  TIME_CONTROL_KEYS,
  createGame,
  parsePgn,
  randomChess960Fen,
  type Color,
  type Game,
} from "@openchess/shared";
import { useState } from "react";
import type { Config } from "@/lib/session";

type Props = {
  initial: Config;
  canClose: boolean;
  onClose: () => void;
  onStart: (config: Config, game?: Game) => void;
};

type Side = Color | "random";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? "on" : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function NewGameDialog({ initial, canClose, onClose, onStart }: Props) {
  const [mode, setMode] = useState(initial.mode);
  const [personality, setPersonality] = useState(initial.personality);
  const [side, setSide] = useState<Side>(initial.human);
  const [variant, setVariant] = useState(initial.variant);
  const [time, setTime] = useState(initial.time);
  const [importText, setImportText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function start() {
    const human: Color =
      side === "random" ? (Math.random() < 0.5 ? "w" : "b") : side;

    let startFen = variant === "chess960" ? randomChess960Fen() : STARTING_FEN;
    let game: Game | undefined;

    const text = importText.trim();
    if (text) {
      try {
        if (text.includes("[") || /\d\./.test(text)) {
          const parsed = parsePgn(text);
          startFen = parsed.startingFen;
          game = parsed.game;
        } else {
          startFen = text;
          game = createGame(text);
        }
      } catch (problem) {
        setError(
          problem instanceof Error ? problem.message : "Could not read that.",
        );
        return;
      }
    }

    onStart({ mode, personality, human, startFen, variant, time }, game);
  }

  return (
    <div className="overlay" onPointerDown={canClose ? onClose : undefined}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-game-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-head">
          <h2 id="new-game-title">New game</h2>
          {canClose && (
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          )}
        </header>

        <section className="field">
          <span className="field-label">Opponent</span>
          <Segmented
            label="Opponent"
            value={mode}
            onChange={setMode}
            options={[
              { value: "ai", label: "Computer" },
              { value: "local", label: "Pass & play" },
            ]}
          />
        </section>

        {mode === "ai" && (
          <>
            <section className="field">
              <span className="field-label">Engine personality</span>
              <div className="personalities">
                {PERSONALITY_LIST.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`personality${entry.id === personality ? " on" : ""}`}
                    onClick={() => setPersonality(entry.id)}
                  >
                    <span className="personality-top">
                      <strong>{entry.name}</strong>
                      <span className="elo">{entry.elo}</span>
                    </span>
                    <span className="personality-blurb">{entry.blurb}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="field">
              <span className="field-label">Play as</span>
              <Segmented
                label="Play as"
                value={side}
                onChange={setSide}
                options={[
                  { value: "w", label: "White" },
                  { value: "random", label: "Random" },
                  { value: "b", label: "Black" },
                ]}
              />
            </section>
          </>
        )}

        <section className="field">
          <span className="field-label">Variant</span>
          <Segmented
            label="Variant"
            value={variant}
            onChange={setVariant}
            options={[
              { value: "standard", label: "Standard" },
              { value: "chess960", label: "Chess960" },
            ]}
          />
        </section>

        <section className="field">
          <span className="field-label">Clock</span>
          <Segmented
            label="Clock"
            value={time}
            onChange={setTime}
            options={[
              { value: "none", label: "None" },
              ...TIME_CONTROL_KEYS.map((key) => ({
                value: key,
                label: TIME_CONTROLS[key].label,
              })),
            ]}
          />
        </section>

        <details className="field import">
          <summary>Start from a FEN or PGN</summary>
          <textarea
            value={importText}
            onChange={(event) => {
              setImportText(event.target.value);
              setError(null);
            }}
            placeholder="Paste a FEN or a PGN. It overrides the variant."
            rows={4}
            spellCheck={false}
          />
          {error && <p className="error">{error}</p>}
        </details>

        <button type="button" className="primary wide" onClick={start}>
          Start game
        </button>
      </div>
    </div>
  );
}
