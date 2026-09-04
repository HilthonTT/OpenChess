import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { RouterProvider } from "react-router";
import { parseArgs } from "./lib/cli-args";
import { setNotificationsEnabled } from "./lib/notify";
import { createAppRouter } from "./router";

const parsed = parseArgs(Bun.argv.slice(2));

if (parsed.kind === "print") {
  if (parsed.code === 0) {
    console.log(parsed.text);
  } else {
    console.error(parsed.text);
  }
  process.exit(parsed.code);
}

if (parsed.options.bell !== undefined) {
  setNotificationsEnabled(parsed.options.bell);
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
