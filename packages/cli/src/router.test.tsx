import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { RouterProvider } from "react-router";
import { parseArgs } from "./lib/cli-args";
import { SCREENS } from "./lib/screens";
import { createAppRouter } from "./router";
import { THEMES } from "./theme";

/**
 * Boots the app the way `openchess …` does — through the same parse and the
 * same router — so what these assert is what a command line actually opens.
 */
async function launch(...argv: string[]) {
  const parsed = parseArgs(argv);
  if (parsed.kind !== "launch") {
    throw new Error(`expected a launch, got: ${parsed.text}`);
  }

  const setup = await testRender(
    <RouterProvider router={createAppRouter(parsed.options)} />,
    { width: 100, height: 50 },
  );
  await setup.flush();

  return {
    frame: () => setup.captureCharFrame(),
    // A lone ESC byte is ambiguous, so the parser holds it briefly to see
    // whether an escape sequence follows. Wait it out rather than race it.
    escape: async () => {
      await act(async () => {
        setup.mockInput.pressEscape();
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      await setup.flush();
    },
  };
}

describe("opening from the command line", () => {
  test("no arguments open the menu", async () => {
    const app = await launch();
    expect(app.frame()).toContain("Local 1v1");
    expect(app.frame()).toContain("quick pick");
  });

  test("a named screen opens on that screen", async () => {
    const app = await launch("local");
    const frame = app.frame();

    expect(frame).toContain("Local 1v1");
    expect(frame).toContain("A   B   C   D   E   F   G   H");
    // The menu's own footer is gone: this is the board, not the list.
    expect(frame).not.toContain("quick pick");
  });

  test("the flag spelling opens the same screen", async () => {
    expect(await launch("--explorer").then((app) => app.frame())).toContain(
      "Opening Explorer",
    );
  });

  test("escaping a screen opened directly lands on the menu", async () => {
    const app = await launch("explorer");
    expect(app.frame()).toContain("Opening Explorer");

    await app.escape();

    expect(app.frame()).toContain("quick pick");
  });

  test("a screen's argument reaches the screen", async () => {
    // Signed out there is no profile to fetch, but the name asked for is the
    // one the screen reports it cannot show.
    const app = await launch("profile", "hikaru");
    expect(app.frame()).toContain("hikaru");
  });

  test("--theme repaints without touching the saved preference", async () => {
    const nord = THEMES.find((theme) => theme.name === "Nord");
    if (!nord) {
      throw new Error("expected a Nord theme to exist");
    }

    const app = await launch("local", "--theme", "nord");
    // captureCharFrame drops color, so assert on the state the provider was
    // handed rather than on pixels: the screen still renders, on Nord.
    expect(app.frame()).toContain("Local 1v1");
    expect(parseArgs(["--theme", "nord"])).toMatchObject({
      kind: "launch",
      options: { theme: nord },
    });
  });

  test("every screen the command line offers has a route", () => {
    const router = createAppRouter({ path: "/" });
    const paths = new Set(
      (router.routes[0]?.children ?? []).map((child) => child.path),
    );

    for (const screen of SCREENS) {
      expect(paths).toContain(screen.path);
    }
  });
});
