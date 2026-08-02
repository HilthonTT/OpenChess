import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "../../layouts/root-layout";
import { Home } from "../../screens/home";
import { Explorer } from "../../screens/explorer";
import { LocalGame } from "../../screens/local-game";

/**
 * The `?` overlay, driven through the real renderer — the only way to check the
 * thing it actually has to get right, which is that the keys it lists belong to
 * the screen underneath rather than to whichever one registered last.
 */
async function renderApp(initialPath: string, height = 40) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <RootLayout />,
        children: [
          { index: true, element: <Home /> },
          { path: "/local", element: <LocalGame /> },
          { path: "/explorer", element: <Explorer /> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );

  const setup = await testRender(<RouterProvider router={router} />, {
    width: 100,
    height,
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
    help: () => press(() => setup.mockInput.typeText("?")),
    type: (text: string) => press(() => setup.mockInput.typeText(text)),
    arrow: (direction: "up" | "down" | "left" | "right") =>
      press(() => setup.mockInput.pressArrow(direction)),
    escape: () =>
      press(async () => {
        setup.mockInput.pressEscape();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }),
  };
}

describe("the ? overlay", () => {
  test("lists the board screen's own keys, not the menu's", async () => {
    const app = await renderApp("/local");

    expect(app.frame()).not.toContain("take the last move back");

    await app.help();

    const frame = app.frame();
    expect(frame).toContain("take the last move back");
    // The shared board group, and the screen's own, both reach it.
    expect(frame).toContain("move the cursor");
    expect(frame).toContain("Chess960");
    // And the section the overlay appends for itself.
    expect(frame).toContain("this list");

    app.renderer.destroy();
  });

  test("? closes it again", async () => {
    const app = await renderApp("/local");

    await app.help();
    expect(app.frame()).toContain("take the last move back");

    await app.help();
    expect(app.frame()).not.toContain("take the last move back");

    app.renderer.destroy();
  });

  test("escape closes it, and leaves the screen underneath alone", async () => {
    const app = await renderApp("/local");

    await app.help();
    await app.escape();

    const frame = app.frame();
    expect(frame).not.toContain("take the last move back");
    // Still on the board rather than back at the menu: the escape was the
    // dialog's, and the screen never saw it.
    expect(frame).toContain("Local 1v1");

    app.renderer.destroy();
  });

  test("the menu gets the menu's keys", async () => {
    const app = await renderApp("/");

    await app.help();

    const frame = app.frame();
    expect(frame).toContain("open a screen by the number beside it");
    // Nowhere to go back to, so the appended section says so by omission.
    expect(frame).not.toContain("back to the menu");

    app.renderer.destroy();
  });

  test("does not open the explorer's search, which is the unshifted slash", async () => {
    const app = await renderApp("/explorer");

    await app.help();

    const frame = app.frame();
    expect(frame).toContain("pick a continuation");
    expect(frame).not.toContain("Jump to an opening");

    app.renderer.destroy();
  });

  test("scrolls rather than spilling off a short terminal", async () => {
    const app = await renderApp("/local", 20);

    await app.help();

    // The list is longer than the room for it, so the last rows are held back
    // behind the scroll rather than drawn past the bottom of the dialog.
    expect(app.frame()).toContain("move the cursor");
    expect(app.frame()).not.toContain("copy the game as a PGN");
    expect(app.frame()).toContain("more");

    await app.arrow("down");
    await app.arrow("down");
    expect(app.frame()).not.toContain("move the cursor");

    app.renderer.destroy();
  });

  test("the unshifted slash still opens that search", async () => {
    const app = await renderApp("/explorer");

    await app.type("/");

    expect(app.frame()).toContain("Jump to an opening");

    app.renderer.destroy();
  });
});
