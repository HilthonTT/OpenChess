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

/** Pick the clock to queue for. You are only paired with a like-for-like one. */
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

/**
 * The queue. Polling is the whole protocol: every poll is a heartbeat, the
 * first poll to find a partner creates the game, and an unfinished online game
 * is returned immediately — so this screen is also how a match is resumed.
 */
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
          // Nobody sits and watches a queue. Being left is what this screen is
          // for, so the pairing is rung for unconditionally — there is no
          // "they answered quickly" case here, only a wait that just ended.
          notify(
            `Matched with ${result.game.opponent?.username ?? "an opponent"}`,
          );
          onMatched(result.game);
          return;
        }

        setMessage(null);
      } catch (error) {
        // Stay in the loop: a missed poll only means we drop out of the queue
        // if it keeps happening, and the message says why we're stuck.
        if (!cancelled) {
          setMessage(errorMessage(error));
        }
      }

      // Guarded so a poll that was in flight at unmount cannot reschedule the
      // loop — an undead loop would quietly re-enqueue us from the home screen.
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
      // Leaving the screen is leaving the queue, as fast as the network allows
      // rather than by heartbeat timeout.
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
