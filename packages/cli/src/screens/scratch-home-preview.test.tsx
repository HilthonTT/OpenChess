import { test, mock } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "../layouts/root-layout";
import { Home } from "./home";

async function frameFor(label: string) {
  const router = createMemoryRouter(
    [{ path: "/", element: <RootLayout />, children: [{ index: true, element: <Home /> }] }],
    { initialEntries: ["/"] },
  );
  const setup = await testRender(<RouterProvider router={router} />, {
    width: 90,
    height: Number(process.env.H ?? 40),
  });
  await setup.flush();
  await new Promise((r) => setTimeout(r, 200));
  await setup.flush();
  console.log(`\n\n===== ${label} =====\n` + setup.captureCharFrame());
}

test("signed out", async () => {
  mock.module("../lib/auth", () => ({
    getAuth: () => null,
    saveAuth: () => {},
    clearAuth: () => {},
  }));
  await frameFor("SIGNED OUT");
});

test("signed in", async () => {
  mock.module("../lib/auth", () => ({
    getAuth: () => ({ token: "t" }),
    saveAuth: () => {},
    clearAuth: () => {},
  }));
  mock.module("../lib/api-client", () => ({
    apiClient: {
      me: {
        $get: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ username: "hansdev", level: 7, coins: 320 }),
        }),
      },
    },
  }));
  await frameFor("SIGNED IN");
});
