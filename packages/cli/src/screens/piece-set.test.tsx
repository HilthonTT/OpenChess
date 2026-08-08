import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "../layouts/root-layout";
import { Home } from "./home";
import { LocalGame } from "./local-game";
import type { PieceSet } from "../components/pieces";

/**
 * The board as it actually reaches the terminal, drawn with a given set.
 *
 * Rendered rather than unit-tested against `renderPiece`, because the thing
 * worth checking is the wiring: the set is chosen at the root and read by a
 * hook eight components down, and a provider that never reached the board would
 * still pass every test in `components/pieces`.
 */
async function boardWith(pieceSet: PieceSet): Promise<string> {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <RootLayout initialPieceSet={pieceSet} />,
        children: [
          { index: true, element: <Home /> },
          { path: "/local", element: <LocalGame /> },
        ],
      },
    ],
    { initialEntries: ["/local"] },
  );

  const setup = await testRender(<RouterProvider router={router} />, {
    width: 100,
    height: 40,
  });
  await setup.flush();

  return setup.captureCharFrame();
}

describe("the piece set the board draws with", () => {
  test("unicode draws figurines", async () => {
    const frame = await boardWith("unicode");

    expect(frame).toContain("♞");
    expect(frame).toContain("♛");
    // Black's back rank is the hollow set.
    expect(frame).toContain("♘");
    expect(frame).toContain("♕");
  });

  test("letters draws letters, and no figurine survives", async () => {
    const frame = await boardWith("letters");

    for (const figurine of ["♚", "♛", "♜", "♝", "♞", "♟"]) {
      expect(frame).not.toContain(figurine);
    }
    for (const figurine of ["♔", "♕", "♖", "♗", "♘", "♙"]) {
      expect(frame).not.toContain(figurine);
    }

    // White along rank 1 and black along rank 8, as a FEN spells them.
    expect(frame).toContain("│ R │ N │ B │ Q │ K │ B │ N │ R │");
    expect(frame).toContain("│ r │ n │ b │ q │ k │ b │ n │ r │");
  });

  test("the grid is the same width either way", async () => {
    // The letters set exists because the figurines can be drawn wrong; it would
    // be a poor cure if it moved the board's columns as well.
    //
    // Measured with the variation selectors stripped: they occupy no column,
    // so counting them would make the figurine rank look eight wider than the
    // board the terminal actually draws.
    const columns = (line: string) => line.replace(/︎/g, "").length;

    const lineOf = (frame: string, needle: string) =>
      frame.split("\n").find((line) => line.includes(needle));

    const unicodeRank = lineOf(await boardWith("unicode"), "♞");
    const lettersRank = lineOf(await boardWith("letters"), "N");

    expect(unicodeRank).toBeDefined();
    expect(lettersRank).toBeDefined();
    expect(columns(lettersRank as string)).toBe(columns(unicodeRank as string));
  });
});
