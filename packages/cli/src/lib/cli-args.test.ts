import { describe, expect, test } from "bun:test";
import { parseArgs } from "./cli-args";
import { SCREENS } from "./screens";

/** The launch options, or a failure if the parse printed instead. */
function launch(...argv: string[]) {
  const parsed = parseArgs(argv);
  if (parsed.kind !== "launch") {
    throw new Error(`expected a launch, got: ${parsed.text}`);
  }
  return parsed.options;
}

/** The message and code, or a failure if the parse launched instead. */
function printed(...argv: string[]) {
  const parsed = parseArgs(argv);
  if (parsed.kind !== "print") {
    throw new Error(`expected a message, got a launch at ${parsed.options.path}`);
  }
  return parsed;
}

describe("screens", () => {
  test("no arguments open the menu", () => {
    expect(launch()).toEqual({ path: "/", theme: undefined });
  });

  test("a screen name opens that screen", () => {
    expect(launch("puzzles").path).toBe("/puzzles");
  });

  test("every screen in the list can be named", () => {
    for (const screen of SCREENS) {
      // The ones that take an argument need it before they will launch.
      const argv =
        screen.name === "profile" ? [screen.name, "hikaru"] : [screen.name];
      expect(launch(...argv).path).toBe(screen.path);
    }
  });

  test("a screen may be written as a flag", () => {
    expect(launch("--local").path).toBe("/local");
  });

  test("an unknown screen is refused", () => {
    const { text, code } = printed("chekcers");
    expect(code).toBe(1);
    expect(text).toContain(`Unknown screen "chekcers"`);
  });

  test("an unknown option is refused", () => {
    const { text, code } = printed("--turbo");
    expect(code).toBe(1);
    expect(text).toContain(`Unknown option "--turbo"`);
  });

  test("two screens are refused rather than one of them silently winning", () => {
    const { text, code } = printed("--local", "--online");
    expect(code).toBe(1);
    expect(text).toContain("Pick one screen");
  });

  test("the same screen twice is not two screens", () => {
    expect(launch("local", "--local").path).toBe("/local");
  });
});

describe("screen arguments", () => {
  test("a screen that takes a name carries it as router state", () => {
    expect(launch("profile", "hikaru")).toEqual({
      path: "/profile",
      state: { username: "hikaru" },
      theme: undefined,
    });
  });

  test("a screen that takes a name is refused without one", () => {
    const { text, code } = printed("profile");
    expect(code).toBe(1);
    expect(text).toContain("needs a username");
  });

  test("a screen that takes nothing is refused an argument", () => {
    const { text, code } = printed("stats", "hikaru");
    expect(code).toBe(1);
    expect(text).toContain("takes no argument");
  });

  test("a third word is refused", () => {
    const { text, code } = printed("profile", "hikaru", "extra");
    expect(code).toBe(1);
    expect(text).toContain(`Unexpected argument "extra"`);
  });
});

describe("--theme", () => {
  test("names a theme for the session", () => {
    expect(launch("--theme", "nord").theme?.name).toBe("Nord");
  });

  test("takes its value joined as well as separate", () => {
    expect(launch("--theme=nord").theme?.name).toBe("Nord");
  });

  test("ignores case, spacing and accents in the name", () => {
    expect(launch("--theme", "TOKYO-NIGHT").theme?.name).toBe("Tokyo Night");
    expect(launch("--theme", "rose-pine").theme?.name).toBe("Rosé Pine");
    expect(launch("--theme", "rosepinemoon").theme?.name).toBe("Rosé Pine Moon");
  });

  test("combines with a screen, in either order", () => {
    expect(launch("--theme", "nord", "rush")).toEqual({
      path: "/rush",
      theme: expect.objectContaining({ name: "Nord" }),
    });
    expect(launch("rush", "--theme", "nord").path).toBe("/rush");
  });

  test("the joined form does not swallow the screen after it", () => {
    expect(launch("--theme=nord", "rush").path).toBe("/rush");
  });

  test("a theme nobody has is refused, with the near misses", () => {
    const { text, code } = printed("--theme", "rose");
    expect(code).toBe(1);
    expect(text).toContain(`Unknown theme "rose"`);
    expect(text).toContain("Rosé Pine");
  });

  test("a missing value is refused rather than read as a screen", () => {
    expect(printed("--theme").code).toBe(1);
    expect(printed("--theme", "").code).toBe(1);
  });
});

describe("the bell", () => {
  test("is left to OPENCHESS_BELL when neither flag is given", () => {
    // Undefined rather than true: the parse has no opinion to impose, and the
    // environment's answer is read where the bell itself is.
    expect(launch().bell).toBeUndefined();
    expect(launch("online").bell).toBeUndefined();
  });

  test("--no-bell turns it off, --bell back on", () => {
    expect(launch("--no-bell").bell).toBe(false);
    expect(launch("--bell").bell).toBe(true);
  });

  test("goes with a screen, in either order", () => {
    expect(launch("online", "--no-bell")).toMatchObject({
      path: "/online",
      bell: false,
    });
    expect(launch("--no-bell", "profile", "hikaru")).toMatchObject({
      path: "/profile",
      state: { username: "hikaru" },
      bell: false,
    });
  });

  test("the last one on the line wins", () => {
    expect(launch("--bell", "--no-bell").bell).toBe(false);
    expect(launch("--no-bell", "--bell").bell).toBe(true);
  });

  test("is not mistaken for a screen", () => {
    // The flag branch under it reads "--no-bell" as a screen called "no-bell",
    // which is the failure this ordering exists to prevent.
    expect(launch("--no-bell").path).toBe("/");
  });

  test("--help says both spellings", () => {
    const { text } = printed("--help");
    expect(text).toContain("--no-bell");
    expect(text).toContain("OPENCHESS_BELL");
  });
});

describe("messages", () => {
  test("--help lists every screen and leaves with 0", () => {
    const { text, code } = printed("--help");
    expect(code).toBe(0);
    for (const screen of SCREENS) {
      expect(text).toContain(screen.summary);
    }
  });

  test("-h is --help", () => {
    expect(printed("-h").text).toBe(printed("--help").text);
  });

  test("--version prints a version and leaves with 0", () => {
    const { text, code } = printed("--version");
    expect(code).toBe(0);
    expect(text).toMatch(/^openchess \d+\.\d+\.\d+/);
    expect(printed("-v").text).toBe(text);
  });

  test("--themes prints the names --theme accepts", () => {
    const { text, code } = printed("--themes");
    expect(code).toBe(0);
    expect(text.split("\n")).toContain("Nord");
    // Every listed name has to be one --theme will take back.
    for (const name of text.split("\n")) {
      expect(launch("--theme", name).theme?.name).toBe(name);
    }
  });

  test("a message wins over anything else on the line", () => {
    expect(printed("rush", "--help").code).toBe(0);
    expect(printed("--nonsense", "--help").code).toBe(0);
  });
});
