import { useCallback, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useLocation, useNavigate } from "react-router";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import { HintBar } from "../components/hint-bar";
import {
  acceptFriend,
  addFriend,
  declineFriend,
  lastSeenLabel,
  removeFriend,
} from "../lib/friends";
import {
  fetchPlayerProfile,
  type ProfileGame,
  type PublicProfile,
} from "../lib/players";
import { sparkline } from "../lib/sparkline";
import { errorMessage } from "../lib/utils";
import { useAuth } from "../providers/auth";
import { BASE_LAYER_ID, useKeyboardLayer } from "../providers/keyboard-layer";
import { useUITheme } from "../providers/theme";

const WIDTH = 56;
/** Label column width; values line up in a second column. */
const LABEL_W = 14;
/** Cells in the XP progress bar. */
const BAR_W = 20;

/**
 * Somebody else's profile: what they have made public by playing.
 *
 * Reached by name rather than by id — from the friends list, from a leaderboard
 * row, from the board you are sitting at — so the screen takes a `username` in
 * its navigation state and is the same screen whichever door it was opened
 * through. Your own name works too, and reports itself as such.
 */
export function Profile() {
  const auth = useAuth();
  const theme = useUITheme();
  const location = useLocation();
  const navigate = useNavigate();
  const { isTopLayer } = useKeyboardLayer();

  const username = (location.state as { username?: string } | null)?.username;

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Unfriending is irreversible enough to want a second keypress. */
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  /** Bumped to refetch, after `r` or an action that changed something. */
  const [attempt, setAttempt] = useState(0);

  const signedIn = auth.status === "signed-in";

  useEffect(() => {
    if (!signedIn || username === undefined) {
      return;
    }

    let cancelled = false;
    setError(null);

    void fetchPlayerProfile(username)
      .then((found) => {
        if (!cancelled) {
          setProfile(found);
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
  }, [signedIn, username, attempt]);

  /**
   * Run an action, say what it did, and refetch.
   *
   * `label` is what it usually did; an action that turned out to do something
   * else returns its own line instead. That is not hypothetical — asking
   * somebody who had already asked you makes you friends rather than sending a
   * request, and "asked them" would be the wrong thing to print.
   */
  const act = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      setPending(true);
      setNote(null);

      try {
        // A string is the action overriding the label; anything else is just
        // whatever the API helper happened to hand back.
        const outcome = await action();

        setNote(typeof outcome === "string" ? outcome : label);
        setAttempt((value) => value + 1);
      } catch (cause) {
        setNote(errorMessage(cause));
      } finally {
        setPending(false);
      }
    },
    [],
  );

  const friendship = profile?.friendship;

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || !profile || pending) {
      return;
    }

    if (confirmingRemove && key.name !== "x") {
      setConfirmingRemove(false);
    }

    switch (key.name) {
      // `f` is the friend key in each of its readings, exactly as `d` is the
      // draw key at the board: what it does is written on the footer, and what
      // it does is always the one thing there is to do about this player.
      case "f":
        if (friendship?.state === "none") {
          void act(`Asked ${profile.username}.`, async () => {
            const friend = await addFriend(profile.username);

            return friend.status === "ACCEPTED"
              ? `${profile.username} had already asked — you're friends.`
              : undefined;
          });
        } else if (
          friendship?.state === "requestReceived" &&
          friendship.friendshipId
        ) {
          void act(`${profile.username} is now a friend.`, () =>
            acceptFriend(friendship.friendshipId!),
          );
        }
        break;
      case "d":
        if (
          friendship?.state === "requestReceived" &&
          friendship.friendshipId
        ) {
          void act("Declined.", () => declineFriend(friendship.friendshipId!));
        }
        break;
      case "x":
        if (
          (friendship?.state !== "friends" &&
            friendship?.state !== "requestSent") ||
          !friendship.friendshipId
        ) {
          break;
        }
        if (confirmingRemove) {
          setConfirmingRemove(false);
          void act(
            friendship.state === "friends"
              ? `${profile.username} removed.`
              : "Request withdrawn.",
            () => removeFriend(friendship.friendshipId!),
          );
        } else {
          setConfirmingRemove(true);
        }
        break;
      case "c":
        if (friendship?.state !== "self") {
          void navigate("/challenges", {
            state: { opponent: profile.username },
          });
        }
        break;
      case "r":
        setAttempt((value) => value + 1);
        break;
    }
  });

  const subtitle = profile
    ? `${lastSeenLabel(profile.presence)} · joined ${new Date(
        profile.joinedAt,
      ).toLocaleDateString()}`
    : "A player's record";

  const status = confirmingRemove
    ? friendship?.state === "friends"
      ? `Remove ${profile?.username} as a friend? Press x again to confirm`
      : "Withdraw your request? Press x again to confirm"
    : note;

  return (
    <GameScreen
      title={profile ? profile.username : (username ?? "Profile")}
      subtitle={subtitle}
      width={WIDTH}
      onEscape={() => {
        if (confirmingRemove) {
          setConfirmingRemove(false);
          return true;
        }
        return false;
      }}
      footer={<FriendKeys state={friendship?.state} />}
    >
      {!signedIn ? (
        <text fg={theme.dim}>Sign in from the menu to look players up.</text>
      ) : username === undefined ? (
        // The screen is only ever reached with a name in tow; without one there
        // is nothing to show and nowhere useful to guess.
        <text fg={theme.dim}>
          Open a player from the Friends list or the leaderboard.
        </text>
      ) : error ? (
        <ErrorNotice title="Couldn't load that player" message={error} />
      ) : !profile ? (
        <text fg={theme.dim}>Loading…</text>
      ) : (
        <Card profile={profile} />
      )}

      {status ? <text fg={theme.gold}>{status}</text> : null}

      <HintBar hints={[{ key: "r", label: "refresh" }]} />
    </GameScreen>
  );
}

/** The footer, written as whatever the friend keys currently mean. */
function FriendKeys({ state }: { state?: PublicProfile["friendship"]["state"] }) {
  const theme = useUITheme();

  if (state === undefined || state === "self") {
    return null;
  }

  const key = (name: string, label: string) => (
    <>
      <span fg={theme.cream}>{name}</span>
      <span fg={theme.faint}>{` ${label} `}</span>
    </>
  );

  return (
    <>
      {state === "none" ? key("f", "add friend") : null}
      {state === "requestReceived" ? (
        <>
          {key("f", "accept")}
          {key("d", "decline")}
        </>
      ) : null}
      {state === "friends" ? key("x", "unfriend") : null}
      {state === "requestSent" ? key("x", "withdraw request") : null}
      {key("c", "challenge")}
    </>
  );
}

function Card({ profile }: { profile: PublicProfile }) {
  const theme = useUITheme();

  const games = profile.wins + profile.losses + profile.draws;
  const winRate = games > 0 ? Math.round((profile.wins / games) * 100) : null;

  // The curve arrives ready to plot — oldest first, and anchored at the rating
  // before its first change so a rise off the left edge is not drawn flat.
  const line =
    profile.ratingHistory.length > 1 ? sparkline(profile.ratingHistory) : null;

  const span = profile.xpIntoLevel + profile.xpToNextLevel;
  const filled = span > 0 ? Math.round((profile.xpIntoLevel / span) * BAR_W) : 0;

  return (
    <box flexDirection="column" width={WIDTH - 6} gap={1}>
      {profile.title ? (
        <text fg={theme.gold}>{profile.title}</text>
      ) : null}

      <box flexDirection="column">
        <Row label={`Level ${profile.level}`}>
          <span fg={theme.gold}>{"█".repeat(filled)}</span>
          <span fg={theme.faint}>{"░".repeat(BAR_W - filled)}</span>
        </Row>
        <Row label="Rating">
          <span fg={theme.cream}>{String(profile.rating)}</span>
          {profile.peakRating !== null && profile.peakRating > profile.rating ? (
            <span fg={theme.dim}>{`  peak ${profile.peakRating}`}</span>
          ) : null}
          {line ? <span fg={theme.gold}>{`  ${line}`}</span> : null}
        </Row>
        <Row label="Record">
          <span fg={theme.text}>
            {`${profile.wins} W · ${profile.losses} L · ${profile.draws} D`}
          </span>
          {winRate === null ? null : (
            <span fg={theme.dim}>{`  (${winRate}% wins)`}</span>
          )}
        </Row>
        <Row label="Win streak">
          <span fg={theme.text}>{String(profile.currentWinStreak)}</span>
          <span fg={theme.dim}>{` now · best ${profile.topWinStreak}`}</span>
        </Row>
        <Row label="Puzzles">
          <span fg={theme.cream}>{String(profile.puzzleRating)}</span>
          <span fg={theme.dim}>{` · ${profile.puzzlesSolved} solved`}</span>
        </Row>
        <Row label="Achievements">
          <span fg={theme.gold}>{String(profile.achievementsUnlocked)}</span>
          {profile.recentAchievements[0] ? (
            <span fg={theme.dim}>
              {`  latest: ${profile.recentAchievements[0].name}`}
            </span>
          ) : null}
        </Row>
      </box>

      <RecentGames games={profile.recentGames} />
    </box>
  );
}

const OUTCOME_MARK: Record<ProfileGame["outcome"], string> = {
  win: "W",
  loss: "L",
  draw: "D",
  aborted: "–",
};

function RecentGames({ games }: { games: ProfileGame[] }) {
  const theme = useUITheme();

  const color = (outcome: ProfileGame["outcome"]) =>
    outcome === "win"
      ? theme.gold
      : outcome === "loss"
        ? theme.walnut
        : theme.dim;

  return (
    <box flexDirection="column">
      <text fg={theme.walnut}>Recent games</text>
      {games.length === 0 ? (
        <text fg={theme.dim}>{"  No finished games yet."}</text>
      ) : (
        games.map((game) => (
          <text key={game.id}>
            <span fg={color(game.outcome)}>
              {`  ${OUTCOME_MARK[game.outcome]}  `}
            </span>
            <span fg={theme.text}>
              {(game.opponent ?? "unknown").slice(0, 20).padEnd(22)}
            </span>
            <span fg={theme.faint}>
              {game.mode === "AI" ? "bot" : "online"}
            </span>
          </text>
        ))
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
