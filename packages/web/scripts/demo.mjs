// Records the README demos of the web build: a still of the new-game dialog,
// one of a game in progress, and a GIF of a short game against a bot.
// Needs playwright-core, gifenc and pngjs (resolvable from here or via
// NODE_PATH) and a Chromium (CHROMIUM=path). Build first: bun run build:web.
// Usage: node demo.mjs <assetsDir>
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import gifenc from "gifenc";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";

const { GIFEncoder, applyPalette, quantize } = gifenc;
const ASSETS = process.argv[2] ?? ".";
const OUT = fileURLToPath(new URL("../out/", import.meta.url));
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};

const server = createServer((req, res) => {
  let path = normalize(decodeURIComponent(req.url.split("?")[0]));
  if (path.endsWith("/") || path.endsWith("\\")) path += "index.html";
  try {
    const body = readFileSync(join(OUT, path));
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage({
  viewport: { width: 1200, height: 760 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});
await page.goto(url);
await page.waitForSelector(".board .sq");
await page.waitForTimeout(500);

const frames = [];
const snap = async (ms) => frames.push({ png: await page.screenshot(), ms });

async function square(name, orientation = "w") {
  const box = await page.locator(".board").boundingBox();
  const size = box.width / 8;
  let file = name.charCodeAt(0) - 97;
  let rank = Number(name[1]) - 1;
  if (orientation === "b") {
    file = 7 - file;
    rank = 7 - rank;
  }
  return { x: box.x + (file + 0.5) * size, y: box.y + (7 - rank + 0.5) * size };
}

async function click(name) {
  const { x, y } = await square(name);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

async function waitForBot(ply) {
  await page.waitForFunction(
    (n) => document.querySelectorAll(".moves .san:not(:empty)").length >= n,
    ply,
    { timeout: 30000 },
  );
  await page.waitForTimeout(250);
}

// The new-game dialog.
// A first visit opens it on its own.
if (!(await page.locator(".dialog").isVisible())) {
  await page.getByRole("button", { name: "New game" }).click();
}
await page.locator(".segmented button", { hasText: "Computer" }).click();
await page.locator(".personality").nth(2).click();
await page.waitForTimeout(300);
writeFileSync(join(ASSETS, "web-new-game.png"), await page.screenshot());
await snap(1800);
await page.getByRole("button", { name: "Start game" }).click();
await page.waitForTimeout(400);
await snap(900);

// A short game: White's moves are played, the bot answers.
const moves = [
  ["e2", "e4"],
  ["g1", "f3"],
  ["f1", "c4"],
  ["e1", "g1"],
  ["d2", "d3"],
];
for (const [i, [from, to]] of moves.entries()) {
  await click(from);
  await page.waitForTimeout(150);
  await snap(600);
  await click(to);
  await page.waitForTimeout(200);
  await snap(500);
  await waitForBot((i + 1) * 2).catch(() => {});
  await snap(900);
}
await snap(1600);
writeFileSync(join(ASSETS, "web.png"), await page.screenshot());

// One palette across every frame, so colours do not flicker between them.
const images = frames.map((f) => PNG.sync.read(f.png));
const { width, height } = images[0];
const size = width * height * 4;
const sample = new Uint8Array(images.length * size);
images.forEach((img, i) => {
  sample.set(img.data, i * size);
});
const palette = quantize(sample, 256);
const gif = GIFEncoder();
images.forEach((img, i) => {
  gif.writeFrame(applyPalette(img.data, palette), width, height, {
    palette: i === 0 ? palette : undefined,
    delay: frames[i].ms,
    repeat: 0,
  });
});
gif.finish();
writeFileSync(join(ASSETS, "web.gif"), gif.bytes());

await browser.close();
server.close();
console.log(`web.gif (${frames.length} frames), web.png, web-new-game.png`);
