// Turns frames recorded by record.tsx into PNG stills and GIFs.
// Needs playwright-core, gifenc and pngjs (resolvable from here or via
// NODE_PATH) and a Chromium (CHROMIUM=path).
// Usage: node render.mjs <framesDir> <assetsDir>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import gifenc from "gifenc";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";

const { GIFEncoder, applyPalette, quantize } = gifenc;
const [, , FRAMES, ASSETS] = process.argv;
const CELL_W = 10;
const CELL_H = 20;
const PAD = 16;

const css = (c) => {
  const b = c.buffer ?? c;
  const v = [b[0], b[1], b[2], b[3]].map((x) => (x <= 1 ? x * 255 : x));
  return `rgba(${v[0] | 0},${v[1] | 0},${v[2] | 0},${(v[3] / 255).toFixed(3)})`;
};
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function html({ cols, rows, lines }) {
  const bg = css(lines[0]?.spans[0]?.bg ?? [0, 0, 0, 255]);
  let out = "";
  lines.forEach((line, y) => {
    let x = 0;
    for (const span of line.spans) {
      let fg = css(span.fg);
      let back = css(span.bg);
      const a = span.attributes;
      if (a & 32) [fg, back] = [back, fg];
      const style = [
        a & 1 ? "font-weight:700" : "",
        a & 2 ? "opacity:.6" : "",
        a & 4 ? "font-style:italic" : "",
        a & 8 ? "text-decoration:underline" : "",
      ].join(";");
      // One positioned cell per column, so fallback glyphs cannot shift the grid.
      const chars = [...span.text.replace(/[︎️]/g, "")];
      out += `<div style="left:${x * CELL_W}px;top:${y * CELL_H}px;width:${span.width * CELL_W}px;background:${back}" class="r"></div>`;
      for (const ch of chars) {
        if (ch !== " ") {
          out += `<div class="c${/[♔-♟]/.test(ch) ? " p" : ""}" style="left:${x * CELL_W}px;top:${y * CELL_H}px;color:${fg};${style}">${esc(ch)}︎</div>`;
        }
        x++;
      }
    }
  });
  return `<!doctype html><html><head><style>
    html,body{margin:0;background:${bg}}
    #t{position:relative;margin:${PAD}px;width:${cols * CELL_W}px;height:${rows * CELL_H}px}
    .r{position:absolute;height:${CELL_H}px}
    .c{position:absolute;width:${CELL_W}px;height:${CELL_H}px;line-height:${CELL_H}px;text-align:center;
       font:17px "Cascadia Mono","Consolas","Segoe UI Symbol",monospace;white-space:pre;overflow:visible}
    .p{font:20px "Segoe UI Symbol","DejaVu Sans",sans-serif;line-height:${CELL_H}px}
  </style></head><body><div id="t">${out}</div></body></html>`;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
mkdirSync(ASSETS, { recursive: true });

for (const file of readdirSync(FRAMES).filter((f) => f.endsWith(".json"))) {
  const name = file.replace(/\.json$/, "");
  const { cols, rows, frames } = JSON.parse(readFileSync(join(FRAMES, file)));
  const page = await browser.newPage({
    viewport: {
      width: cols * CELL_W + PAD * 2,
      height: rows * CELL_H + PAD * 2,
    },
    deviceScaleFactor: 1,
  });
  const shots = [];
  for (const f of frames) {
    await page.setContent(html({ cols, rows, lines: f.lines }));
    shots.push(await page.screenshot());
    if (process.env.DUMP)
      writeFileSync(
        join(ASSETS, `${name}-${shots.length - 1}.png`),
        shots.at(-1),
      );
  }
  await page.close();

  if (frames.length === 1) {
    writeFileSync(join(ASSETS, `${name}.png`), shots[0]);
    console.log(`${name}.png`);
    continue;
  }

  // One palette across every frame, so colours do not flicker between them.
  const images = shots.map((s) => PNG.sync.read(s));
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
  writeFileSync(join(ASSETS, `${name}.gif`), gif.bytes());
  console.log(`${name}.gif`);
}

await browser.close();
