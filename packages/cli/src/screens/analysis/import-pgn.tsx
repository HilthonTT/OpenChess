import { useCallback, useEffect, useRef, useState } from "react";
import type { InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { createGame } from "@openchess/shared";
import type { Color } from "@openchess/shared";
import { GameScreen } from "../../components/game-screen";
import { HintBar } from "../../components/hint-bar";
import { DEFAULT_EXPORT_DIR, importPgnFile } from "../../lib/pgn-files";
import type { PgnDetails } from "../../lib/copy-game";

import {
  useKeyboardLayer,
  BASE_LAYER_ID,
} from "../../providers/keyboard-layer";
import { useKeymap } from "../../providers/keymap";
import { useUITheme } from "../../providers/theme";
import { errorMessage } from "../../lib/utils";

import { IMPORT_KEYMAP, WIDTH } from "./keymaps";

export type ReviewSource = {
  history: string[];
  startingFen: string;
  orientation: Color;
  subtitle: string;
  gameId: string | null;
  pgn?: PgnDetails;
};

export function positionSource(fen: string): ReviewSource {
  const turn = createGame(fen).position.turn;

  return {
    history: [],
    startingFen: fen,
    orientation: turn,
    subtitle: `A position — ${turn === "w" ? "White" : "Black"} to move`,
    gameId: null,
    pgn: { result: "*", tags: { event: "Position" } },
  };
}

export function ImportPgn({
  onImported,
  onCancel,
  path: given,
}: {
  onImported: (source: ReviewSource) => void;
  onCancel: () => void;
  path?: string;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  useKeymap(IMPORT_KEYMAP);

  const inputRef = useRef<InputRenderable>(null);
  const [path, setPath] = useState(given ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    if (path.trim() === "") {
      return;
    }

    setPending(true);
    setMessage(null);

    try {
      const { game, total } = await importPgnFile(path);
      const white = game.tags.white ?? "White";
      const black = game.tags.black ?? "Black";

      onImported({
        history: game.moves,
        startingFen: game.startingFen,
        orientation: "w",
        subtitle: `${white} vs ${black} · ${game.result}${
          total > 1 ? ` · game 1 of ${total}` : ""
        }`,
        gameId: null,
        pgn: { result: game.result, tags: game.tags },
      });
    } catch (cause) {
      setMessage(errorMessage(cause));
      setPending(false);
    }
  }, [onImported, path]);

  const launched = useRef(false);
  useEffect(() => {
    if (given === undefined || launched.current) {
      return;
    }
    launched.current = true;
    void load();
  }, [given, load]);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || pending) {
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      void load();
    }
  });

  return (
    <GameScreen
      title="Import a PGN"
      subtitle="Review a game that was never played here"
      width={WIDTH}
      onEscape={() => {
        onCancel();
        return true;
      }}
    >
      <box flexDirection="column" width={WIDTH - 6} gap={1}>
        <input
          ref={inputRef}
          value={given ?? ""}
          placeholder={`path to a .pgn file (exports land in ${DEFAULT_EXPORT_DIR})`}
          focused
          onContentChange={() => setPath(inputRef.current?.value ?? "")}
        />
        {message ? <text fg={theme.gold}>{message}</text> : null}
        {pending ? <text fg={theme.dim}>Reading…</text> : null}
      </box>

      <HintBar
        hints={[
          { key: "enter", label: "open" },
          { key: "esc", label: "cancel" },
        ]}
      />
    </GameScreen>
  );
}
