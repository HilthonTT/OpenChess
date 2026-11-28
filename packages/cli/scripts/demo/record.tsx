// Drives the TUI headlessly and records coloured frames for the README demos.
// Usage: bun packages/cli/scripts/demo/record.tsx <outDir>
// Then:  node packages/cli/scripts/demo/render.mjs <outDir> <assetsDir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { RouterProvider } from "react-router";
import { parseArgs } from "../../src/lib/cli-args";
import { createAppRouter } from "../../src/router";

const OUT = process.argv[2] ?? "demo-frames";
mkdirSync(OUT, { recursive: true });

const WIDTH = 100;
const HEIGHT = 34;

type Frame = { lines: unknown[]; ms: number };

async function scene(
  name: string,
  argv: string[],
  script: (app: Awaited<ReturnType<typeof launch>>) => Promise<void>,
  height = HEIGHT,
) {
  const app = await launch(argv, height);
  await script(app);
  writeFileSync(
    join(OUT, `${name}.json`),
    JSON.stringify({ cols: WIDTH, rows: height, frames: app.frames }),
  );
  app.destroy();
  console.log(`${name}: ${app.frames.length} frames`);
}

async function launch(argv: string[], height: number) {
  const parsed = parseArgs(argv);
  if (parsed.kind !== "launch") throw new Error(parsed.text);
  const setup = await testRender(
    <RouterProvider router={createAppRouter(parsed.options)} />,
    { width: WIDTH, height },
  );
  await setup.flush();
  const frames: Frame[] = [];

  const run = async (action: () => void | Promise<void>, wait = 60) => {
    await act(async () => {
      await action();
      await Bun.sleep(wait);
    });
    await setup.flush();
  };

  return {
    frames,
    destroy: () => setup.renderer.destroy(),
    frame: () => setup.captureCharFrame(),
    snap: (ms: number) => {
      frames.push({ lines: setup.captureSpans().lines, ms });
    },
    settle: (ms = 400) => run(() => {}, ms),
    key: (key: string, mods?: { ctrl?: boolean; shift?: boolean }) =>
      run(() => setup.mockInput.pressKey(key, mods)),
    arrow: (d: "up" | "down" | "left" | "right") =>
      run(() => setup.mockInput.pressArrow(d)),
    enter: () => run(() => setup.mockInput.pressEnter()),
    escape: () => run(() => setup.mockInput.pressEscape(), 120),
    type: (text: string) => run(() => setup.mockInput.typeText(text)),
    click: (square: string) =>
      run(() => {
        const { x, y } = squareOnScreen(setup.captureCharFrame(), square);
        return setup.mockMouse.click(x, y);
      }),
  };
}

// Where a square sits on screen, read off the frame (white at the bottom).
function squareOnScreen(frame: string, name: string) {
  const file = name.charCodeAt(0) - "a".charCodeAt(0);
  const label = ` ${name[1]} │`;
  const lines = frame.replace(/︎/g, "").split("\n");
  const y = lines.findIndex((line) => line.includes(label));
  if (y === -1) throw new Error(`No rank ${name[1]} on screen`);
  const x = (lines[y] as string).indexOf(label) + label.length + file * 4 + 1;
  return { x, y };
}

const THEME = "tokyo-night";

// 1. The menu.
await scene(
  "menu",
  ["--theme", THEME],
  async (app) => {
    await app.settle();
    app.snap(1400);
    for (let i = 0; i < 5; i++) {
      await app.arrow("down");
      app.snap(350);
    }
    app.snap(900);
  },
  40,
);

// 2. A quick game, ending in mate.
await scene("local", ["local", "--theme", THEME], async (app) => {
  await app.settle();
  app.snap(1000);
  const moves = [
    ["e2", "e4"],
    ["e7", "e5"],
    ["f1", "c4"],
    ["b8", "c6"],
    ["d1", "h5"],
    ["g8", "f6"],
    ["h5", "f7"],
  ];
  for (const [from, to] of moves) {
    await app.click(from as string);
    app.snap(650);
    await app.click(to as string);
    app.snap(700);
  }
  await app.settle(300);
  app.snap(3000);
});

// 3. Reviewing a game in Analysis.
const pgnPath = join(OUT, "opera.pgn");
writeFileSync(
  pgnPath,
  `[Event "Paris"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0
`,
);
await scene(
  "analysis",
  ["--pgn", pgnPath, "--theme", THEME],
  async (app) => {
    // The engine reviews the game in the background; give it time.
    for (
      let i = 0;
      i < 40 && /analys|review/i.test(app.frame()) === false;
      i++
    ) {
      await app.settle(250);
    }
    await app.settle(4000);
    await app.key("home");
    app.snap(1200);
    for (let i = 0; i < 14; i++) {
      await app.arrow("right");
      app.snap(450);
    }
    await app.key("n");
    app.snap(1400);
    await app.key("end");
    app.snap(3000);
  },
  40,
);

// 4. The same board in a handful of themes.
const OPENING = [
  ["e2", "e4"],
  ["c7", "c5"],
  ["g1", "f3"],
  ["d7", "d6"],
  ["d2", "d4"],
  ["c5", "d4"],
];
await scene("themes", ["local", "--theme", THEME], async (app) => {
  await app.settle();
  for (const [from, to] of OPENING) {
    await app.click(from as string);
    await app.click(to as string);
  }
  app.snap(1100);
  // The same position under other themes, each a fresh launch with --theme so
  // the theme you saved is left alone.
  for (const theme of [
    "classic-chess",
    "catppuccin-mocha",
    "gruvbox-dark",
    "nord",
    "rose-pine",
    "everforest-dark",
    "dracula",
  ]) {
    const other = await launch(["local", "--theme", theme], HEIGHT);
    await other.settle();
    for (const [from, to] of OPENING) {
      await other.click(from as string);
      await other.click(to as string);
    }
    other.snap(1100);
    app.frames.push(...other.frames);
    other.destroy();
  }
});

// 5. The opening explorer, a still.
await scene(
  "explorer",
  ["explorer", "--theme", THEME],
  async (app) => {
    await app.settle();
    await app.enter();
    await app.enter();
    await app.enter();
    app.snap(1000);
  },
  42,
);

process.exit(0);
