import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { RouterProvider } from "react-router";
import { createAppRouter } from "../../router";

/**
 * The `ctrl+k` palette, driven through the real router — what it has to get
 * right is that it opens from anywhere and that picking a row lands you on the
 * screen that row names, so both are asserted against a real navigation.
 */
async function launch(path = "/") {
  const setup = await testRender(
    <RouterProvider router={createAppRouter({ path })} />,
    { width: 100, height: 50 },
  );
  await setup.flush();

  const press = async (action: () => void | Promise<void>) => {
    await act(async () => {
      await action();
    });
    await setup.flush();
  };

  return {
    renderer: setup.renderer,
    frame: () => setup.captureCharFrame(),
    goto: () => press(() => setup.mockInput.pressKey("k", { ctrl: true })),
    type: (text: string) => press(() => setup.mockInput.typeText(text)),
    enter: () => press(() => setup.mockInput.pressEnter()),
    escape: () =>
      press(async () => {
        setup.mockInput.pressEscape();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }),
  };
}

describe("the go-to palette", () => {
  test("opens from the menu and lists the screens", async () => {
    const app = await launch();

    expect(app.frame()).not.toContain("Go to");

    await app.goto();

    const frame = app.frame();
    expect(frame).toContain("Go to");
    // Including the rows past the ninth, which is the whole point of it.
    expect(frame).toContain("Openings");

    app.renderer.destroy();
  });

  test("opens from a screen that is not the menu", async () => {
    const app = await launch("/local");

    await app.goto();

    expect(app.frame()).toContain("Go to");

    app.renderer.destroy();
  });

  test("typing filters, and enter opens what is left", async () => {
    const app = await launch();

    await app.goto();
    await app.type("openings");
    await app.enter();

    // The explorer, reached without touching the menu cursor.
    expect(app.frame()).toContain("Opening Explorer");

    app.renderer.destroy();
  });

  test("a name that matches nothing says so rather than opening something", async () => {
    const app = await launch();

    await app.goto();
    await app.type("zzzz");

    expect(app.frame()).toContain("Nothing by that name");

    await app.enter();

    // Still the palette, still on the menu underneath.
    expect(app.frame()).toContain("Nothing by that name");

    app.renderer.destroy();
  });

  test("escape closes it and leaves the screen underneath alone", async () => {
    const app = await launch("/local");

    await app.goto();
    await app.escape();

    const frame = app.frame();
    expect(frame).not.toContain("Nothing by that name");
    expect(frame).toContain("Local 1v1");

    app.renderer.destroy();
  });
});
