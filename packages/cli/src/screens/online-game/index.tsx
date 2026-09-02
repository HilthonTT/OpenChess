import { useCallback, useEffect, useState } from "react";
import type { TimeControlKey } from "@openchess/shared";
import { useLocation } from "react-router";
import { ErrorNotice } from "../../components/error-notice";
import { GameScreen } from "../../components/game-screen";
import { SignedOut } from "../../components/signed-out";
import { fetchGame, type ServerGame } from "../../lib/games";
import { errorMessage } from "../../lib/utils";
import { useAuth } from "../../providers/auth";
import { useUITheme } from "../../providers/theme";

import { SUBTITLE, TITLE } from "./constants";
import { OnlineMatch } from "./match";
import { QueueSetup, Searching } from "./queue";

/**
 * Online 1v1: matched by the server's queue, played move by move over the
 * same authoritative API as AI games, with the opponent's moves arriving by
 * poll. Rating here is the real thing — PvP is the only place it moves.
 */
export function OnlineGame() {
  const auth = useAuth();
  const theme = useUITheme();
  const location = useLocation();
  const [match, setMatch] = useState<ServerGame | null>(null);
  // `undefined` until the player picks a clock; `null` is an untimed queue.
  const [timeControl, setTimeControl] = useState<
    TimeControlKey | null | undefined
  >(undefined);

  // A game handed to us by name rather than by the queue — an accepted
  // challenge, or a rematch. The board opens straight on it, skipping both the
  // clock picker and the search.
  const openGameId =
    (location.state as { gameId?: string } | null)?.gameId ?? null;
  const [opening, setOpening] = useState(openGameId !== null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    if (openGameId === null) {
      return;
    }

    let cancelled = false;
    setOpening(true);
    setOpenError(null);

    void fetchGame(openGameId)
      .then((game) => {
        if (!cancelled) {
          setMatch(game);
          setOpening(false);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setOpenError(errorMessage(cause));
          setOpening(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [openGameId]);

  const onMatched = useCallback((game: ServerGame) => setMatch(game), []);
  // A rematch drops back into the same queue, keeping the chosen clock.
  const onRequeue = useCallback(() => setMatch(null), []);

  if (auth.status !== "signed-in") {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE}>
        <SignedOut
          title="Online play needs an account"
          message="These are the games that move your Elo."
        />
      </GameScreen>
    );
  }

  if (match) {
    return <OnlineMatch key={match.id} initial={match} onRequeue={onRequeue} />;
  }

  if (openError) {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE}>
        <ErrorNotice title="Couldn't open that game" message={openError} />
      </GameScreen>
    );
  }

  if (opening) {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE}>
        <text fg={theme.dim}>Opening the board…</text>
      </GameScreen>
    );
  }

  if (timeControl === undefined) {
    return <QueueSetup onChoose={setTimeControl} />;
  }

  return (
    <Searching
      timeControl={timeControl}
      onMatched={onMatched}
      onBack={() => setTimeControl(undefined)}
    />
  );
}
