import { useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import { HintBar } from "../components/hint-bar";
import { SignedOut } from "../components/signed-out";
import {
  fetchProfile,
  fetchRatingHistory,
  fetchStats,
  type PlayerStats,
  type Profile,
  type RatingHistory,
} from "../lib/profile";
import {
  fetchRushBests,
  RUSH_MODES,
  RUSH_MODE_LABEL,
  type RushBest,
} from "../lib/puzzles";
import { sparkline } from "../lib/sparkline";
import { useAuth } from "../providers/auth";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { useKeymap, type Keymap } from "../providers/keymap";
import { useUITheme } from "../providers/theme";
import { errorMessage } from "../lib/utils";

const KEYMAP: Keymap = {
  title: "Stats",
  sections: [{ keys: [{ keys: "r", label: "refresh" }] }],
};

const WIDTH = 52;
/** Label column width; values line up in a second column. */
const LABEL_W = 14;
/** Cells in the XP progress bar. */
const BAR_W = 20;
/**
 * Changes in the rating sparkline. One less than the XP bar's width because the
 * line also plots the rating *before* the first change, so `BAR_W - 1` changes
 * draw `BAR_W` bars and the two rows come out the same length.
 */
const CURVE_POINTS = BAR_W - 1;

type Data = {
  profile: Profile;
  stats: PlayerStats;
  curve: RatingHistory;
  rush: RushBest[];
};

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

    void Promise.all([
      fetchProfile(),
      fetchStats(),
      fetchRatingHistory(CURVE_POINTS),
      // Supplementary, so it is allowed to fail on its own: a rush endpoint
      // having a bad day should cost this one block, not blank the whole card
      // behind an error about a feature the player may never have opened.
      fetchRushBests().catch(() => [] as RushBest[]),
    ])
      .then(([profile, stats, curve, rush]) => {
        if (!cancelled) {
          setData({ profile, stats, curve, rush });
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

  useKeymap(KEYMAP);

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
        <SignedOut
          title="Stats need an account"
          message="Your record and rating are the server's."
        />
      ) : error ? (
        <ErrorNotice title="Couldn't load your stats" message={error} />
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

function Card({ data }: { data: Data }) {
  const theme = useUITheme();
  const { profile, stats, curve, rush } = data;

  const games = stats.wins + stats.losses + stats.draws;
  const winRate = games > 0 ? Math.round((stats.wins / games) * 100) : null;

  // The curve is plotted from where the window opened, so the first bar is the
  // rating *before* its first change rather than after it — otherwise the line
  // would draw a rise that happened off its left edge as if it were flat.
  const ratings = [
    curve.startingRating,
    ...curve.history.map((point) => point.rating),
  ];
  // One point is a straight line, not a curve: nothing has changed yet.
  const line = curve.history.length > 0 ? sparkline(ratings) : null;
  const swing = curve.current - curve.startingRating;

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
          {curve.peak !== null && curve.peak > stats.rating ? (
            <span fg={theme.dim}>{`  peak ${curve.peak}`}</span>
          ) : null}
        </Row>
        {line === null ? null : (
          // "Trend", not "last N games": a point is a rating *change*, and a
          // draw between equals moves Elo by zero, so the bars would undercount
          // games played. Bar heights are relative to this window's own range —
          // see `sparkline` — which is why the signed swing is printed beside
          // them, making the line readable as a quantity and not only a shape.
          <Row label="Trend">
            <span fg={theme.gold}>{line}</span>
            <span fg={theme.dim}>
              {`  ${swing >= 0 ? "+" : ""}${swing}`}
            </span>
          </Row>
        )}
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
        <Row label="Daily streak">
          {/* A broken run is shown greyed rather than zeroed: the number is
              still true, it just cannot be extended any more. */}
          <span fg={stats.loginStreakAlive ? theme.gold : theme.faint}>
            {`${stats.currentLoginStreak} ${
              stats.currentLoginStreak === 1 ? "day" : "days"
            }`}
          </span>
          <span fg={theme.dim}>
            {stats.loginStreakAlive
              ? ` · best ${stats.topLoginStreak}`
              : ` (lapsed) · best ${stats.topLoginStreak}`}
          </span>
        </Row>
        <Row label="Playing since">
          <span fg={theme.dim}>
            {new Date(profile.createdAt).toLocaleDateString()}
          </span>
        </Row>
      </box>

      <RushBests bests={rush} />
    </box>
  );
}

/**
 * Best Puzzle Rush score per mode.
 *
 * Kept apart from the record above rather than folded into it, because a rush
 * score is not on the same axis as anything else here: it moves no rating and
 * counts no games, so a row of it beside the win/loss record would invite the
 * two to be read as one measure of how you are doing.
 */
function RushBests({ bests }: { bests: RushBest[] }) {
  const theme = useUITheme();

  // Modes are listed from the catalog rather than from the response, so a mode
  // never run still shows — "you have not tried survival" is the useful answer,
  // and a list that grew a row the first time you played one would be worse.
  const played = bests.filter((entry) => entry.runs > 0);

  return (
    <box flexDirection="column">
      <text fg={theme.walnut}>Puzzle Rush</text>
      {played.length === 0 ? (
        <text fg={theme.dim}>
          {"  No runs yet — Puzzle Rush is on the menu."}
        </text>
      ) : (
        RUSH_MODES.map((mode) => {
          const entry = bests.find((best) => best.mode === mode);
          const runs = entry?.runs ?? 0;

          return (
            <Row key={mode} label={RUSH_MODE_LABEL[mode]}>
              <span fg={runs > 0 ? theme.gold : theme.faint}>
                {runs > 0 ? String(entry!.best) : "—"}
              </span>
              <span fg={theme.dim}>
                {runs > 0
                  ? ` best · ${runs} ${runs === 1 ? "run" : "runs"}`
                  : " not yet run"}
              </span>
            </Row>
          );
        })
      )}
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
