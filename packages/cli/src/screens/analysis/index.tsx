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
  const [imported, setImported] = useState<ReviewSource | null>(
    state?.fen === undefined ? null : positionSource(state.fen),
  );
  const [importing, setImporting] = useState(false);
  const [launchPgn, setLaunchPgn] = useState<string | null>(
    state?.pgnPath ?? null,
  );

  const back = useCallback(() => {
    setSelected(null);
    setImported(null);
  }, []);

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
