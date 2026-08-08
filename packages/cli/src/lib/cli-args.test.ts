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
    throw new Error(
      `expected a message, got a launch at ${parsed.options.path}`,
    );
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

describe("--pieces", () => {
  test("names a piece set for the session", () => {
    expect(launch("--pieces", "letters").pieceSet).toBe("letters");
    expect(launch("--pieces", "unicode").pieceSet).toBe("unicode");
  });

  test("takes its value joined as well as separate", () => {
    expect(launch("--pieces=letters").pieceSet).toBe("letters");
  });

  test("ignores case in the name", () => {
    expect(launch("--pieces", "LETTERS").pieceSet).toBe("letters");
  });

  test("keeps the saved set when it is not given", () => {
    expect(launch("rush").pieceSet).toBeUndefined();
  });

  test("combines with a screen, in either order", () => {
    expect(launch("--pieces", "letters", "rush").path).toBe("/rush");
    expect(launch("rush", "--pieces", "letters").pieceSet).toBe("letters");
  });

  test("a set nobody has lists the ones there are", () => {
    const { text, code } = printed("--pieces", "figurine");
    expect(code).toBe(1);
    expect(text).toContain('Unknown piece set "figurine"');
    expect(text).toContain("letters");
    expect(text).toContain("unicode");
  });

  test("the flag on its own says what it wants", () => {
    const { text, code } = printed("--pieces");
    expect(code).toBe(1);
    expect(text).toContain("needs a set");
  });

  test("the help lists it", () => {
    expect(printed("--help").text).toContain("--pieces");
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
    expect(launch("--theme", "rosepinemoon").theme?.name).toBe(
      "Rosé Pine Moon",
    );
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

describe("--fen", () => {
  const MATE = "6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1";

  test("opens analysis on the position", () => {
    expect(launch("--fen", MATE)).toMatchObject({
      path: "/analysis",
      state: { fen: MATE },
    });
  });

  test("takes its value joined as well as separate", () => {
    expect(launch(`--fen=${MATE}`).state).toEqual({ fen: MATE });
  });

  test("reads a FEN the shell was not asked to keep together", () => {
    // What someone pasting a position from another tool actually types: six
    // fields, six arguments, no quotes anywhere.
    expect(launch("--fen", ...MATE.split(" ")).state).toEqual({ fen: MATE });
  });

  test("stops gathering fields at the next flag", () => {
    const short = "8/8/8/8/8/8/8/K6k w - -";
    expect(
      launch("--fen", ...short.split(" "), "--theme", "nord"),
    ).toMatchObject({
      path: "/analysis",
      state: { fen: short },
      theme: expect.objectContaining({ name: "Nord" }),
    });
  });

  test("stops gathering fields at a screen name", () => {
    // Gathered greedily but never past a screen, so the conflict below is
    // reported rather than "rush" disappearing into the position.
    const { text, code } = printed(
      "--fen",
      "8/8/8/8/8/8/8/K6k",
      "w",
      "-",
      "-",
      "rush",
    );
    expect(code).toBe(1);
    expect(text).toContain("analysis");
    expect(text).toContain("rush");
  });

  test("names the analysis screen explicitly without conflicting", () => {
    expect(launch("analysis", "--fen", MATE).path).toBe("/analysis");
  });

  test("a position the engine cannot read is refused", () => {
    const { text, code } = printed("--fen", "not-a-position");
    expect(code).toBe(1);
    expect(text).toContain("isn't a position I can read");
  });

  test("a missing value is refused", () => {
    expect(printed("--fen").code).toBe(1);
    expect(printed("--fen=").code).toBe(1);
  });

  test("goes with the bell and theme flags", () => {
    expect(launch("--fen", MATE, "--no-bell")).toMatchObject({
      path: "/analysis",
      state: { fen: MATE },
      bell: false,
    });
  });
});

describe("--pgn", () => {
  test("opens analysis on the file", () => {
    expect(launch("--pgn", "game.pgn")).toMatchObject({
      path: "/analysis",
      state: { pgnPath: "game.pgn" },
    });
  });

  test("takes its value joined as well as separate", () => {
    expect(launch("--pgn=game.pgn").state).toEqual({ pgnPath: "game.pgn" });
  });

  test("the joined form does not swallow the screen after it", () => {
    // Nothing else may be opened alongside it, so the screen it would have
    // eaten is reported as the conflict it is.
    expect(printed("--pgn=game.pgn", "rush").code).toBe(1);
  });

  test("a path is taken as written, spaces and all", () => {
    expect(launch("--pgn", "my games/one.pgn").state).toEqual({
      pgnPath: "my games/one.pgn",
    });
  });

  test("a missing value is refused rather than read as a screen", () => {
    expect(printed("--pgn").code).toBe(1);
    expect(printed("--pgn", "").code).toBe(1);
  });

  test("another screen alongside it is refused", () => {
    const { text, code } = printed("--pgn", "game.pgn", "--rush");
    expect(code).toBe(1);
    expect(text).toContain("analysis");
  });

  test("a position and a file together are refused", () => {
    const { text, code } = printed(
      "--pgn",
      "game.pgn",
      "--fen=6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1",
    );
    expect(code).toBe(1);
    expect(text).toContain("Pick one");
  });

  test("--help says both spellings and what they need", () => {
    const { text } = printed("--help");
    expect(text).toContain("--fen");
    expect(text).toContain("--pgn");
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
