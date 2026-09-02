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

/**
 * Everything the review board needs, whichever way the game got here — off the
 * server, or out of a PGN file. Keeping the board blind to the difference is
 * what lets an imported game get the same treatment as one you played.
 */
export type ReviewSource = {
  /** The moves in SAN. */
  history: string[];
  startingFen: string;
  /** Which way up to draw the board. */
  orientation: Color;
  subtitle: string;
  /** Present only for a game the server holds, which is what can be exported. */
  gameId: string | null;
  /**
   * The headers a copied PGN carries. Whoever built the source knows the names
   * and the result; the board only knows the moves, and a game copied out of
   * here with `[White "?"]` on it would have lost the part worth keeping.
   */
  pgn?: PgnDetails;
};

/**
 * A bare position to review, as `--fen` hands one over.
 *
 * A position is a game with no moves in it, which the review board already
 * draws: one frame, the engine's read on it, and nothing to step through. The
 * board is oriented for whoever is to move, since a position handed over on the
 * command line is nearly always one somebody is asking about from that side.
 */
export function positionSource(fen: string): ReviewSource {
  const turn = createGame(fen).position.turn;

  return {
    history: [],
    startingFen: fen,
    orientation: turn,
    subtitle: `A position — ${turn === "w" ? "White" : "Black"} to move`,
    gameId: null,
    // No players to name and no result to claim — it was a position, not a
    // game. The FEN itself is written from `startingFen`, as it is for any
    // game that did not begin from the standard array.
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
  /** A path from `--pgn`, read on arrival instead of being typed. */
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
        // Copied back out, an imported game keeps the headers it arrived with:
        // it was somebody else's game before it was on this screen.
        pgn: { result: game.result, tags: game.tags },
      });
    } catch (cause) {
      setMessage(errorMessage(cause));
      setPending(false);
    }
  }, [onImported, path]);

  // A path from `--pgn` is read on arrival: the flag already named the file,
  // and asking for it again would be asking twice. It stays in the input, so
  // one that would not open can be corrected rather than retyped.
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
