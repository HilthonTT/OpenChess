import { describe, expect, test } from "bun:test";
import { useCallback, useEffect, useRef, useState } from "react";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import {
  createGame,
  describePremove,
  fromAlgebraic,
  playSan,
} from "@openchess/shared";
import type { Game, PromotionPiece } from "@openchess/shared";
import { useMoveSelection } from "./use-move-selection";

type Committed = { from: number; to: number; promotion?: PromotionPiece };

type Harness = {
  moveCursor: (square: string) => void;
  confirm: () => void;
  promote: (choice: PromotionPiece) => void;
  escape: () => void;
  reply: (san: string) => void;
  premove: () => string | null;
  message: () => string | null;
  committed: () => Committed[];
};

function square(name: string): number {
  const index = fromAlgebraic(name);
  if (index === null) {
    throw new Error(`Not a square: ${name}`);
  }
  return index;
}

function Probe({
  start,
  api,
}: {
  start: Game;
  api: { current: Harness | null };
}) {
  const [game, setGame] = useState(start);
  const [cursor, setCursor] = useState(0);
  const committed = useRef<Committed[]>([]);

  const selection = useMoveSelection({
    game,
    cursor,
    over: false,
    overMessage: "The game is over",
    you: { color: "w", waitMessage: "Waiting…" },
    allowPremove: true,
  });

  const commit = useCallback(
    (from: number, to: number, promotion?: PromotionPiece) => {
      committed.current.push({ from, to, promotion });
    },
    [],
  );

  const { runPremove } = selection;

  useEffect(() => {
    if (game.position.turn === "w") {
      runPremove(commit);
    }
  }, [commit, game, runPremove]);

  api.current = {
    moveCursor: (name) => setCursor(square(name)),
    confirm: () => selection.confirm(commit),
    promote: (choice) => selection.choosePromotion(commit, choice),
    escape: () => selection.handleEscape(),
    reply: (san) => setGame((current) => playSan(current, san)),
    premove: () =>
      selection.premove ? describePremove(selection.premove) : null,
    message: () => selection.message,
    committed: () => committed.current,
  };

  return (
    <text>{selection.premove ? describePremove(selection.premove) : "-"}</text>
  );
}

async function mount(start: Game) {
  const api: { current: Harness | null } = { current: null };
  const setup = await testRender(<Probe start={start} api={api} />, {
    width: 40,
    height: 8,
  });
  await setup.flush();

  const step = async (action: () => void) => {
    await act(async () => {
      action();
    });
    await setup.flush();
  };

  const read = (): Harness => {
    if (api.current === null) {
      throw new Error("The probe never rendered");
    }
    return api.current;
  };

  return {
    pick: async (name: string) => {
      await step(() => read().moveCursor(name));
      await step(() => read().confirm());
    },
    promote: (choice: PromotionPiece) => step(() => read().promote(choice)),
    escape: () => step(() => read().escape()),
    reply: (san: string) => step(() => read().reply(san)),
    premove: () => read().premove(),
    message: () => read().message(),
    committed: () => read().committed(),
  };
}

const AFTER_E4 = playSan(createGame(), "e4");

describe("premoves", () => {
  test("queues a move while it is the opponent's turn", async () => {
    const screen = await mount(AFTER_E4);

    await screen.pick("e4");
    await screen.pick("d5");

    expect(screen.premove()).toBe("e4d5");
    expect(screen.committed()).toEqual([]);
  });

  test("plays it the moment the opponent's move makes it legal", async () => {
    const screen = await mount(AFTER_E4);

    await screen.pick("e4");
    await screen.pick("d5");
    await screen.reply("d5");

    expect(screen.premove()).toBeNull();
    expect(screen.committed()).toEqual([
      { from: square("e4"), to: square("d5"), promotion: undefined },
    ]);
  });

  test("drops it when the opponent's move made it illegal", async () => {
    const screen = await mount(AFTER_E4);

    await screen.pick("e4");
    await screen.pick("d5");
    await screen.reply("e5");

    expect(screen.premove()).toBeNull();
    expect(screen.committed()).toEqual([]);
    expect(screen.message()).toBe("Premove dropped — it isn't legal here");
  });

  test("escape clears a queued premove", async () => {
    const screen = await mount(AFTER_E4);

    await screen.pick("e4");
    await screen.pick("d5");
    await screen.escape();

    expect(screen.premove()).toBeNull();

    await screen.reply("d5");
    expect(screen.committed()).toEqual([]);
  });

  test("carries a promotion choice through to the move", async () => {
    const screen = await mount(createGame("8/4P3/8/1k6/8/8/8/4K3 b - - 0 1"));

    await screen.pick("e7");
    await screen.pick("e8");
    await screen.promote("n");

    expect(screen.premove()).toBe("e7e8n");

    await screen.reply("Ka5");

    expect(screen.committed()).toEqual([
      { from: square("e7"), to: square("e8"), promotion: "n" },
    ]);
  });

  test("refuses to queue one for the opponent's pieces", async () => {
    const screen = await mount(AFTER_E4);

    await screen.pick("d7");

    expect(screen.premove()).toBeNull();
    expect(screen.message()).toBe("You play the White pieces");
  });
});
