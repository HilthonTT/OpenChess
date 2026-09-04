import { useEffect, useState } from "react";
import { TIME_CONTROLS } from "@openchess/shared";
import type { TimeControlKey } from "@openchess/shared";
import { useKeyboard } from "@opentui/react";
import { GameScreen } from "../../components/game-screen";
import { joinPvpQueue, leavePvpQueue, type ServerGame } from "../../lib/games";
import { notify } from "../../lib/notify";
import { errorMessage } from "../../lib/utils";
import {
  useKeyboardLayer,
  BASE_LAYER_ID,
} from "../../providers/keyboard-layer";
import { useKeymap, type Keymap } from "../../providers/keymap";
import { useUITheme } from "../../providers/theme";

import { QUEUE_POLL_MS, SUBTITLE, TITLE } from "./constants";

const QUEUE_KEYMAP: Keymap = {
  title: "Online 1v1 — the queue",
  sections: [
    {
      title: "Pick a clock — you are only paired with a like-for-like one",
      keys: [
        { keys: "1", label: "untimed" },
        { keys: "2", label: "bullet" },
        { keys: "3", label: "blitz" },
        { keys: "4", label: "rapid" },
      ],
    },
  ],
};

export function QueueSetup({
  onChoose,
}: {
  onChoose: (timeControl: TimeControlKey | null) => void;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  useKeymap(QUEUE_KEYMAP);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }
    switch (key.name) {
      case "1":
        onChoose(null);
        break;
      case "2":
        onChoose("bullet");
        break;
      case "3":
        onChoose("blitz");
        break;
      case "4":
        onChoose("rapid");
        break;
    }
  });

  return (
    <GameScreen title={TITLE} subtitle={SUBTITLE}>
      <box flexDirection="column" alignItems="center" gap={1}>
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
        <text fg={theme.dim}>
          You'll only be paired with a player who picked the same.
        </text>
      </box>
    </GameScreen>
  );
}

export function Searching({
  timeControl,
  onMatched,
  onBack,
}: {
  timeControl: TimeControlKey | null;
  onMatched: (game: ServerGame) => void;
  onBack: () => void;
}) {
  const theme = useUITheme();
  const [message, setMessage] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const speedLabel = timeControl ? TIME_CONTROLS[timeControl].label : "Untimed";

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const result = await joinPvpQueue(timeControl);
        if (cancelled) {
          return;
        }

        if (result.status === "matched" && result.game !== null) {
          notify(
            `Matched with ${result.game.opponent?.username ?? "an opponent"}`,
          );
          onMatched(result.game);
          return;
        }

        setMessage(null);
      } catch (error) {
        if (!cancelled) {
          setMessage(errorMessage(error));
        }
      }

      if (!cancelled) {
        timer = setTimeout(() => void poll(), QUEUE_POLL_MS);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      void leavePvpQueue();
    };
  }, [onMatched, timeControl]);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <GameScreen
      title={`${TITLE} · ${speedLabel}`}
      subtitle={SUBTITLE}
      onEscape={() => {
        onBack();
        return true;
      }}
    >
      <box flexDirection="column" alignItems="center" gap={1}>
        <text
          fg={theme.walnut}
        >{`Searching for an opponent… ${seconds}s`}</text>
        <text fg={theme.dim}>
          {`You'll be paired with the next ${speedLabel.toLowerCase()} player.`}
        </text>
        {message ? <text fg={theme.gold}>{message}</text> : null}
      </box>
    </GameScreen>
  );
}
