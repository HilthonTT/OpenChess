import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "../layouts/root-layout";
import { Home } from "./home";
import { LocalGame } from "./local-game";

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

function captureClipboard() {
  const stdout = process.stdout;
  const write = stdout.write;
  const isTTY = stdout.isTTY;
  const chunks: string[] = [];

  stdout.isTTY = true;
  stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    return (write as (...args: unknown[]) => boolean).call(
      stdout,
      chunk,
      ...rest,
    );
  }) as typeof stdout.write;

  const marker = `${String.fromCharCode(0x1b)}]52;c;`;

  return {
    restore: () => {
      stdout.write = write;
      stdout.isTTY = isTTY;
    },
    text: () => {
      const sequence = chunks.filter((chunk) => chunk.includes(marker)).at(-1);
      if (sequence === undefined) {
        return null;
      }
      const payload = sequence.slice(
        sequence.indexOf(marker) + marker.length,
        -1,
      );
      return Buffer.from(payload, "base64").toString("utf8");
    },
  };
}

function countMoveDots(frame: string): number {
  return frame.match(/│ \. /g)?.length ?? 0;
}

describe("local game screen", () => {
  test("selecting Local 1v1 from the menu shows the board", async () => {
    const app = await renderApp("/");
    expect(app.frame()).toContain("Main menu");

    await app.type("1");

    const frame = app.frame();
    expect(frame).toContain("Local 1v1");
    expect(frame).toContain("A   B   C   D   E   F   G   H");
    expect(frame).toContain("White to move");
  });

  test("selecting a pawn marks its legal destinations, and enter plays the move", async () => {
    const app = await renderApp("/local");

    await app.enter();
    expect(countMoveDots(app.frame())).toBe(2);

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
    await app.arrow("left");
    await app.enter();

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
    expect(app.frame()).toContain("Main menu");
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

  test("a capture shows the taken piece and the material score", async () => {
    const app = await renderApp("/local");

    expect(app.frame()).toContain("White  —");
    expect(app.frame()).toContain("Black  —");

    await app.enter();
    await app.arrow("up");
    await app.arrow("up");
    await app.enter();

    await app.arrow("left");
    await app.arrow("up");
    await app.arrow("up");
    await app.arrow("up");
    await app.enter();
    await app.arrow("down");
    await app.arrow("down");
    await app.enter();

    await app.arrow("down");
    await app.arrow("right");
    await app.enter();
    await app.arrow("up");
    await app.arrow("left");
    await app.enter();

    const frame = app.frame();
    expect(frame).toContain("White  ♙");
    expect(frame).toContain("+1");
    expect(frame).toContain("Black  —");
  });

  test("y copies the position, and shift+y the game", async () => {
    const app = await renderApp("/local");
    const clipboard = captureClipboard();

    try {
      await app.enter();
      await app.arrow("up");
      await app.arrow("up");
      await app.enter();

      await app.type("y");
      expect(app.frame()).toContain("Position copied as FEN");
      expect(clipboard.text()).toBe(
        "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
      );

      await app.type("Y");
      expect(app.frame()).toContain("Game copied as PGN");
      expect(clipboard.text()).toContain("1. e4 *");
    } finally {
      clipboard.restore();
    }
  });

  test("flipping the board keeps the arrow keys pointing the way you look", async () => {
    const app = await renderApp("/local");
    await app.type("f");

    expect(app.frame()).toContain("H   G   F   E   D   C   B   A");

    await app.enter();
    expect(countMoveDots(app.frame())).toBe(2);
  });
});
