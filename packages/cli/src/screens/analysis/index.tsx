import { useCallback, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useLocation } from "react-router";
import { GameScreen } from "../../components/game-screen";
import { SignedOut } from "../../components/signed-out";

import { useAuth } from "../../providers/auth";
import {
  useKeyboardLayer,
  BASE_LAYER_ID,
} from "../../providers/keyboard-layer";

import { History } from "./history";
import { ImportPgn, type ReviewSource, positionSource } from "./import-pgn";
import { SUBTITLE, TITLE, WIDTH } from "./keymaps";
import { Review, ReviewBoard } from "./review";

/**
 * The review screen. Reached from the menu — which lists your finished games to
 * pick from — or straight from a game that just ended, which passes its id in
 * the navigation state so the board opens on it. `--fen` and `--pgn` open it on
 * something that was never played here at all.
 */
export function Analysis() {
  const auth = useAuth();
  const location = useLocation();

  const state = location.state as {
    gameId?: string;
    fen?: string;
    pgnPath?: string;
  } | null;

  const [selected, setSelected] = useState<string | null>(
    state?.gameId ?? null,
  );
  /** A game read out of a PGN file, which needs no account at all. */
  const [imported, setImported] = useState<ReviewSource | null>(
    // `--fen` is already a whole position, so it opens the board directly
    // rather than going through the loading a file needs.
    state?.fen === undefined ? null : positionSource(state.fen),
  );
  const [importing, setImporting] = useState(false);
  /**
   * The file `--pgn` named, until it has been read or given up on. Held as
   * state rather than read off the location every render, so escaping out of a
   * file that would not open lands on the game list instead of being handed
   * straight back to the same failure.
   */
  const [launchPgn, setLaunchPgn] = useState<string | null>(
    state?.pgnPath ?? null,
  );

  const back = useCallback(() => {
    setSelected(null);
    setImported(null);
  }, []);

  // `--pgn` is the import screen's job, done without the typing. Its failures
  // land in the same place a typed path's would.
  if (launchPgn !== null) {
    return (
      <ImportPgn
        path={launchPgn}
        onCancel={() => setLaunchPgn(null)}
        onImported={(source) => {
          setLaunchPgn(null);
          setImported(source);
        }}
      />
    );
  }

  if (importing) {
    return (
      <ImportPgn
        onCancel={() => setImporting(false)}
        onImported={(source) => {
          setImporting(false);
          setImported(source);
        }}
      />
    );
  }

  if (imported) {
    return <ReviewBoard source={imported} onBack={back} />;
  }

  // Importing is the one thing here that works signed out: the file is the
  // whole game, and the engine that reviews it is running locally anyway.
  if (auth.status !== "signed-in") {
    return <SignedOutAnalysis onImport={() => setImporting(true)} />;
  }

  return selected ? (
    <Review gameId={selected} onBack={back} />
  ) : (
    <History onOpen={setSelected} onImport={() => setImporting(true)} />
  );
}

function SignedOutAnalysis({ onImport }: { onImport: () => void }) {
  const { isTopLayer } = useKeyboardLayer();

  useKeyboard((key) => {
    if (isTopLayer(BASE_LAYER_ID) && key.name === "i") {
      onImport();
    }
  });

  return (
    <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
      {/* `i` still works here, so it is handed to the notice to advertise
          alongside the sign-in key rather than sitting in a second footer. */}
      <SignedOut
        title="Analysis needs an account"
        message="Your finished games live on the server."
        note="A PGN file needs no account — the engine runs here."
        extraKeys={[
          { keys: "i", label: "review a PGN file — this one needs no account" },
        ]}
        extraHints={[{ key: "i", label: "import a PGN" }]}
      />
    </GameScreen>
  );
}
