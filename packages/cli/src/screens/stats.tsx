import { useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { GameScreen } from "../components/game-screen";
import { HintBar } from "../components/hint-bar";
import {
  fetchProfile,
  fetchStats,
  type PlayerStats,
  type Profile,
} from "../lib/profile";
import { useAuth } from "../providers/auth";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { useUITheme } from "../providers/theme";

const WIDTH = 52;
/** Label column width; values line up in a second column. */
const LABEL_W = 14;
/** Cells in the XP progress bar. */
const BAR_W = 20;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Data = { profile: Profile; stats: PlayerStats };

export function Stats() {
  const auth = useAuth();

  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped to refetch, e.g. after r or a fixed error. */
  const [attempt, setAttempt] = useState(0);

  const signedIn = auth.status === "signed-in";

  useEffect(() => {
    if (!signedIn) {
      return;
    }

    let cancelled = false;
    setError(null);

    void Promise.all([fetchProfile(), fetchStats()])
      .then(([profile, stats]) => {
        if (!cancelled) {
          setData({ profile, stats });
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
  }, [signedIn, attempt]);

  const { isTopLayer } = useKeyboardLayer();

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || !signedIn) {
      return;
    }

    if (key.name === "r") {
      setAttempt((value) => value + 1);
    }
  });

  return (
    <GameScreen title="Stats" subtitle="Your record and rating" width={WIDTH}>
      {!signedIn ? (
        <Notice text="Sign in from the menu to see your stats." />
      ) : error ? (
        <ErrorBody message={error} />
      ) : !data ? (
        <Notice text="Loading…" />
      ) : (
        <Card data={data} />
      )}

      <HintBar hints={[{ key: "r", label: "refresh" }]} />
    </GameScreen>
  );
}

function Notice({ text }: { text: string }) {
  const theme = useUITheme();
  return <text fg={theme.dim}>{text}</text>;
}

function ErrorBody({ message }: { message: string }) {
  const theme = useUITheme();

  return (
    <box flexDirection="column" alignItems="center" gap={1}>
      <text fg={theme.gold}>Couldn't load your stats</text>
      <text fg={theme.dim}>{message}</text>
      <text>
        <span fg={theme.cream}>r</span>
        <span fg={theme.faint}> retry</span>
      </text>
    </box>
  );
}

function Card({ data }: { data: Data }) {
  const theme = useUITheme();
  const { profile, stats } = data;

  const games = stats.wins + stats.losses + stats.draws;
  const winRate = games > 0 ? Math.round((stats.wins / games) * 100) : null;

  // xpIntoLevel + xpToNextLevel spans the whole level band, so this fraction
  // is in [0, 1) by construction.
  const span = profile.xpIntoLevel + profile.xpToNextLevel;
  const filled =
    span > 0 ? Math.round((profile.xpIntoLevel / span) * BAR_W) : 0;

  return (
    <box flexDirection="column" width={WIDTH - 6} gap={1}>
      <text>
        <span fg={theme.cream}>{profile.username}</span>
        {profile.equippedTitle ? (
          <span fg={theme.gold}>{`  ${profile.equippedTitle.label}`}</span>
        ) : null}
      </text>

      <box flexDirection="column">
        <Row label={`Level ${profile.level}`}>
          <span fg={theme.gold}>{"█".repeat(filled)}</span>
          <span fg={theme.faint}>{"░".repeat(BAR_W - filled)}</span>
          <span fg={theme.dim}>{` ${profile.xpIntoLevel}/${span} xp`}</span>
        </Row>
        <Row label="Rating">
          <span fg={theme.cream}>{String(stats.rating)}</span>
        </Row>
        <Row label="Coins">
          <span fg={theme.gold}>{String(profile.coins)}</span>
        </Row>
      </box>

      <box flexDirection="column">
        <Row label="Record">
          <span fg={theme.text}>
            {`${stats.wins} W · ${stats.losses} L · ${stats.draws} D`}
          </span>
          {winRate === null ? null : (
            <span fg={theme.dim}>{`  (${winRate}% wins)`}</span>
          )}
        </Row>
        <Row label="Win streak">
          <span fg={theme.text}>{String(stats.currentWinStreak)}</span>
          <span fg={theme.dim}>{` now · best ${stats.topWinStreak}`}</span>
        </Row>
        <Row label="Playing since">
          <span fg={theme.dim}>
            {new Date(profile.createdAt).toLocaleDateString()}
          </span>
        </Row>
      </box>
    </box>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const theme = useUITheme();

  return (
    <text>
      <span fg={theme.dim}>{label.padEnd(LABEL_W)}</span>
      {children}
    </text>
  );
}
