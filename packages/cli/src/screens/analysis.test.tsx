import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "../layouts/root-layout";
import { Analysis } from "./analysis";

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
    settle: async () => {
      await act(async () => {
        await Bun.sleep(400);
      });
      await setup.flush();
    },
  };
}

describe("opened on a position", () => {
  const BACK_RANK = "6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1";

  test("reviews it without an account", async () => {
    const app = await renderAnalysis({ fen: BACK_RANK });
    const frame = app.frame();

    expect(frame).toContain("Analysis");
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

    expect(app.frame()).toContain("Ra8#");
  });

  test("is a position rather than a game, and says so", async () => {
    const app = await renderAnalysis({ fen: BACK_RANK });
    await app.settle();

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
