import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "../layouts/root-layout";
import { Home } from "./home";
import { Explorer } from "./explorer";

/**
 * Drives the explorer through the real renderer, the way `local-game.test.tsx`
 * drives the board: routing, key handling, and what actually lands on screen.
 */
async function renderApp(initialPath: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <RootLayout />,
        children: [
          { index: true, element: <Home /> },
          { path: "/explorer", element: <Explorer /> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );

  const setup = await testRender(<RouterProvider router={router} />, {
    width: 100,
    height: 50,
  });
  await setup.flush();

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
    arrow: (direction: "up" | "down" | "left" | "right") =>
      press(() => setup.mockInput.pressArrow(direction)),
    type: (text: string) => press(() => setup.mockInput.typeText(text)),
  };
}

describe("opening explorer", () => {
  test("opens on the starting position and lists the book's first moves", async () => {
    const app = await renderApp("/explorer");
    const frame = app.frame();

    expect(frame).toContain("Opening Explorer");
    expect(frame).toContain("A   B   C   D   E   F   G   H");
    expect(frame).toContain("Continuations");
    expect(frame).toContain("The starting position");
    // The heaviest first move, and one it should be offered alongside.
    expect(frame).toContain("e4");
    expect(frame).toContain("d4");
  });

  test("enter plays the highlighted continuation and names the position", async () => {
    const app = await renderApp("/explorer");

    // The list opens on the heaviest move, which is 1.e4.
    await app.enter();

    const frame = app.frame();
    expect(frame).toContain("King's Pawn Opening");
    expect(frame).toContain("B00");
    // The move list beside the board picked it up.
    expect(frame).toContain("1.");
  });

  test("the cursor picks a different line", async () => {
    const app = await renderApp("/explorer");

    // Second row is 1.d4.
    await app.arrow("down");
    await app.enter();

    expect(app.frame()).toContain("Queen's Pawn Opening");
  });

  test("names a line several moves deep", async () => {
    const app = await renderApp("/explorer");

    // 1.e4 (top row), then find 1...c5 and follow the Sicilian in.
    await app.enter();
    expect(app.frame()).toContain("King's Pawn Opening");

    // Black's replies are listed by weight; walk down to the Sicilian.
    let found = false;
    for (let row = 0; row < 10 && !found; row += 1) {
      if (row > 0) {
        await app.arrow("down");
      }
      // The highlighted row is the one carrying the ▸ marker.
      found = /▸ c5/.test(app.frame());
    }
    expect(found).toBe(true);

    await app.enter();
    expect(app.frame()).toContain("Sicilian Defence");
  });

  test("left takes the move back", async () => {
    const app = await renderApp("/explorer");

    await app.enter();
    expect(app.frame()).toContain("King's Pawn Opening");

    await app.arrow("left");
    expect(app.frame()).toContain("The starting position");
  });

  test("r restarts from the initial position", async () => {
    const app = await renderApp("/explorer");

    await app.enter();
    await app.enter();
    expect(app.frame()).not.toContain("The starting position");

    await app.type("r");
    expect(app.frame()).toContain("The starting position");
  });

  test("following the mainline reaches the end of the book", async () => {
    const app = await renderApp("/explorer");

    // Enter always takes the heaviest continuation, and every one of those goes
    // a ply deeper — so the longest line in the book bounds how many it takes to
    // run out of moves.
    for (let ply = 0; ply < 18; ply += 1) {
      await app.enter();
    }

    const frame = app.frame();
    expect(frame).toContain("End of the line");
    expect(frame).not.toContain("Continuations");
  });

  test("flipping turns the board around", async () => {
    const app = await renderApp("/explorer");
    await app.type("f");

    expect(app.frame()).toContain("H   G   F   E   D   C   B   A");
  });

  test("slash opens the opening search", async () => {
    const app = await renderApp("/explorer");
    await app.type("/");

    expect(app.frame()).toContain("Jump to an opening");
  });
});
