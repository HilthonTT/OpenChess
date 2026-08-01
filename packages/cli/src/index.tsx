import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { RouterProvider } from "react-router";
import { parseArgs } from "./lib/cli-args";
import { createAppRouter } from "./router";

// Read the command line before anything takes over the terminal, so `--help`
// and a misspelled flag print a line and leave rather than clearing the screen
// to say it.
const parsed = parseArgs(Bun.argv.slice(2));

if (parsed.kind === "print") {
  if (parsed.code === 0) {
    console.log(parsed.text);
  } else {
    console.error(parsed.text);
  }
  process.exit(parsed.code);
}

const router = createAppRouter(parsed.options);

function App() {
  return <RouterProvider router={router} />;
}

const renderer = await createCliRenderer({
  targetFps: Number(process.env.OPENCHESS_FPS ?? 60),
  exitOnCtrlC: false,
});
createRoot(renderer).render(<App />);
