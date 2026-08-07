import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "../layouts/root-layout";
import { Analysis } from "./analysis";

/**
 * The analysis screen opened the way `--fen` and `--pgn` open it: at its route,
 * carrying the position or the file in the navigation state.
 *
 * Signed out on purpose. Both flags are meant to work without an account — the
 * FEN or the file is the whole game, and the engine reviewing it runs here — so
 * a test that signed in first would not be testing the thing that matters.
 */
async function renderAnalysis(state: { fen?: string; pgnPath?: string }) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <RootLayout />,
        children: [{ path: "/analysis", element: <Analysis /> }],
      },
    ],
    { initialEntries: [{ pathname: "/analysis", state }] },
  );

  const setup = await testRender(<RouterProvider router={router} />, {
    width: 100,
    height: 44,
  });
  await setup.flush();

  return {
    ...setup,
    frame: () => setup.captureCharFrame(),
    /**
     * Let the work that starts on arrival finish and paint: reading the file,
     * and the engine's pass over the position. Both land a tick after the
     * first render, so what they produce is only on screen after this.
     */
    settle: async () => {
      await act(async () => {
        await Bun.sleep(400);
      });
      await setup.flush();
    },
  };
}

describe("opened on a position", () => {
  /** Black is mated by Ra8, which is what the engine ought to find. */
  const BACK_RANK = "6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1";

  test("reviews it without an account", async () => {
    const app = await renderAnalysis({ fen: BACK_RANK });
    const frame = app.frame();

    expect(frame).toContain("Analysis");
    // The sign-in notice is what this must not be.
    expect(frame).not.toContain("needs an account");
  });

  test("says whose move it is, there being no moves to say it", async () => {
    const app = await renderAnalysis({ fen: BACK_RANK });
    expect(app.frame()).toContain("A position — White to move");
  });

  test("a black-to-move position is read from black's side", async () => {
    const app = await renderAnalysis({
      fen: "6k1/5ppp/8/8/8/8/8/R3K3 b - - 0 1",
    });
    expect(app.frame()).toContain("A position — Black to move");
  });

  test("the engine reads the position it was handed", async () => {
    const app = await renderAnalysis({ fen: BACK_RANK });
    await app.settle();

    // The mate is the proof: this is the given FEN being searched, not the
    // starting array, which has nothing to find.
    expect(app.frame()).toContain("Ra8#");
  });

  test("is a position rather than a game, and says so", async () => {
    const app = await renderAnalysis({ fen: BACK_RANK });
    await app.settle();

    // No plies to step through, so the counter has nowhere to go.
    expect(app.frame()).toContain("Move 0/0");
  });
});

describe("opened on a PGN file", () => {
  const MISSING = "no/such/game.pgn";

  test("a file that isn't there says so rather than opening empty", async () => {
    const app = await renderAnalysis({ pgnPath: MISSING });
    await app.settle();

    expect(app.frame()).toContain("No such file");
  });

  test("the path it was given stays on screen to be corrected", async () => {
    const app = await renderAnalysis({ pgnPath: MISSING });
    await app.settle();

    expect(app.frame()).toContain(MISSING);
  });
});
