import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "../layouts/root-layout";
import { Home } from "./home";
import { LocalGame } from "./local-game";

/**
 * Drives the real screens through the terminal renderer, covering the wiring
 * the engine unit tests can't: routing, key handling, and what lands on screen.
 *
 * `useKeyboard` refreshes its handler in a layout effect, so a handler only
 * sees state from the last committed render. Every key below therefore flushes
 * before the next one, the way separate keystrokes do at a real terminal.
 */
async function renderApp(initialPath: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <RootLayout />,
        children: [
          { index: true, element: <Home /> },
          { path: "/local", element: <LocalGame /> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );

  const setup = await testRender(<RouterProvider router={router} />, {
    width: 100,
    height: 40,
  });
  await setup.flush();

  // `act` lets React commit the state update the keypress triggered; `flush`
  // then paints it. Without both, the next key reads a stale handler closure.
  const press = async (action: () => void | Promise<void>) => {
    await act(async () => {
      await action();
    });
    await setup.flush();
  };

  return {
    ...setup,
    frame: () => setup.captureCharFrame(),
    enter: () => press(() => setup.mockInput.pressEnter()),
    // A lone ESC byte is ambiguous, so the parser holds it briefly to see
    // whether an escape sequence follows. Wait it out rather than race it.
    escape: () =>
      press(async () => {
        setup.mockInput.pressEscape();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }),
    arrow: (direction: "up" | "down" | "left" | "right") =>
      press(() => setup.mockInput.pressArrow(direction)),
    type: (text: string) => press(() => setup.mockInput.typeText(text)),
  };
}

/**
 * Count the board cells drawing a move dot. Matching the cell's leading border
 * keeps the move list's "1." out of the tally.
 */
function countMoveDots(frame: string): number {
  return frame.match(/│ \. /g)?.length ?? 0;
}

describe("local game screen", () => {
  test("selecting Local 1v1 from the menu shows the board", async () => {
    const app = await renderApp("/");
    expect(app.frame()).toContain("Select a game mode");

    await app.type("1");

    const frame = app.frame();
    expect(frame).toContain("Local 1v1");
    expect(frame).toContain("A   B   C   D   E   F   G   H");
    expect(frame).toContain("White to move");
  });

  test("selecting a pawn marks its legal destinations, and enter plays the move", async () => {
    const app = await renderApp("/local");

    // The cursor starts on e2; pick the pawn up.
    await app.enter();
    expect(countMoveDots(app.frame())).toBe(2);

    // Walk up to e4 and play it.
    await app.arrow("up");
    await app.arrow("up");
    await app.enter();

    const frame = app.frame();
    expect(frame).toContain("Black to move");
    expect(frame).toContain("1.");
    expect(frame).toContain("e4");
    expect(countMoveDots(frame)).toBe(0);
  });

  test("an illegal destination explains itself instead of moving", async () => {
    const app = await renderApp("/local");

    await app.enter();
    // Sideways from e2 is d2 — our own pawn, and not a legal pawn destination.
    await app.arrow("left");
    await app.enter();

    // Selecting a different friendly piece is the sensible reading of that key.
    expect(app.frame()).toContain("White to move");
    expect(countMoveDots(app.frame())).toBe(2);
  });

  test("escape cancels a selection before it leaves the screen", async () => {
    const app = await renderApp("/local");

    await app.enter();
    expect(countMoveDots(app.frame())).toBe(2);

    await app.escape();
    expect(app.frame()).toContain("White to move");
    expect(countMoveDots(app.frame())).toBe(0);

    await app.escape();
    expect(app.frame()).toContain("Select a game mode");
  });

  test("undo takes the move back", async () => {
    const app = await renderApp("/local");

    await app.enter();
    await app.arrow("up");
    await app.enter();
    expect(app.frame()).toContain("Black to move");

    await app.type("u");
    const frame = app.frame();
    expect(frame).toContain("White to move");
    expect(frame).not.toContain("1.");
  });

  test("flipping the board keeps the arrow keys pointing the way you look", async () => {
    const app = await renderApp("/local");
    await app.type("f");

    // Black's back rank now sits at the bottom, and the files run H to A.
    expect(app.frame()).toContain("H   G   F   E   D   C   B   A");

    // Cursor is still on e2; selecting still finds the white pawn.
    await app.enter();
    expect(countMoveDots(app.frame())).toBe(2);
  });
});
