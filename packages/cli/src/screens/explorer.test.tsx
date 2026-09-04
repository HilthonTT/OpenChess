import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "../layouts/root-layout";
import { Home } from "./home";
import { Explorer } from "./explorer";

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
    expect(frame).toContain("e4");
    expect(frame).toContain("d4");
  });

  test("enter plays the highlighted continuation and names the position", async () => {
    const app = await renderApp("/explorer");

    await app.enter();

    const frame = app.frame();
    expect(frame).toContain("King's Pawn Opening");
    expect(frame).toContain("B00");
    expect(frame).toContain("1.");
  });

  test("the cursor picks a different line", async () => {
    const app = await renderApp("/explorer");

    await app.arrow("down");
    await app.enter();

    expect(app.frame()).toContain("Queen's Pawn Opening");
  });

  test("names a line several moves deep", async () => {
    const app = await renderApp("/explorer");

    await app.enter();
    expect(app.frame()).toContain("King's Pawn Opening");

    let found = false;
    for (let row = 0; row < 10 && !found; row += 1) {
      if (row > 0) {
        await app.arrow("down");
      }
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
