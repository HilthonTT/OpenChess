import { describe, expect, test } from "bun:test";
import { findBestMove } from "./ai";
import { parseFen, toAlgebraic } from "./board";
import { DEFAULT_EVAL_WEIGHTS, evaluate } from "./evaluate";
import { createGame, play } from "./game";
import { generateLegalMoves } from "./moves";
import { bookMoves, chooseBookMove } from "./opening-book";
import { findSanMove } from "./pgn";
import {
  DEFAULT_PERSONALITY,
  DIFFICULTIES,
  PERSONALITIES,
  PERSONALITY_LIST,
  PERSONALITY_ORDER,
  isPersonalityId,
  personalitiesAtTier,
  personalityFor,
  searchLimitsFor,
} from "./personality";
import { search } from "./search";

const START = createGame().position;

describe("the catalog", () => {
  test("every entry is filed under its own id", () => {
    for (const [id, personality] of Object.entries(PERSONALITIES)) {
      expect(personality.id).toBe(id as never);
    }
  });

  test("the display order covers everything exactly once", () => {
    expect([...PERSONALITY_ORDER].sort()).toEqual(
      Object.keys(PERSONALITIES).sort() as never,
    );
  });

  test("is ordered weakest first", () => {
    const elos = PERSONALITY_LIST.map((personality) => personality.elo);
    expect([...elos].sort((a, b) => a - b)).toEqual(elos);
  });

  test("every tier is one a reward can be scaled by", () => {
    for (const personality of PERSONALITY_LIST) {
      expect(DIFFICULTIES, personality.id).toContain(personality.tier);
    }
  });

  test("every tier has at least one bot to play", () => {
    for (const tier of DIFFICULTIES) {
      expect(personalitiesAtTier(tier).length, tier).toBeGreaterThan(0);
    }
  });

  test("each tier's default is a bot that actually plays at that tier", () => {
    for (const tier of DIFFICULTIES) {
      expect(PERSONALITIES[DEFAULT_PERSONALITY[tier]].tier, tier).toBe(tier);
    }
  });

  test("a slip chance is a probability", () => {
    for (const personality of PERSONALITY_LIST) {
      expect(personality.slipChance, personality.id).toBeGreaterThanOrEqual(0);
      expect(personality.slipChance, personality.id).toBeLessThanOrEqual(1);
    }
  });

  test("names an unknown id back to a tier default", () => {
    expect(personalityFor("nonsense", "hard").id).toBe("maestro");
    expect(personalityFor(null, "easy").id).toBe("rookie");
    expect(personalityFor(undefined).id).toBe(DEFAULT_PERSONALITY.medium);
    expect(personalityFor("grinder").id).toBe("grinder");
    expect(isPersonalityId("grinder")).toBe(true);
    expect(isPersonalityId("gary")).toBe(false);
  });

  test("carries its taste and its contempt into the search limits", () => {
    const limits = searchLimitsFor(PERSONALITIES.grinder);
    expect(limits.weights).toBe(PERSONALITIES.grinder.weights);
    expect(limits.contempt).toBe(PERSONALITIES.grinder.contempt);
    expect(limits.timeMs).toBe(PERSONALITIES.grinder.limits.timeMs);
  });
});

describe("every bot can play", () => {
  test("a legal move in the opening", () => {
    for (const id of PERSONALITY_ORDER) {
      const move = findBestMove(START, id);
      expect(move, id).not.toBeNull();
      expect(
        generateLegalMoves(START).some(
          (legal) => legal.from === move!.from && legal.to === move!.to,
        ),
        id,
      ).toBe(true);
    }
  });

  test("and a legal move in a middlegame it has never seen", () => {
    const position = parseFen(
      "r1bq1rk1/pp2ppbp/2np1np1/2p5/2P1P3/2NP1NP1/PP3PBP/R1BQ1RK1 w - - 0 9",
    );

    for (const id of PERSONALITY_ORDER) {
      const move = findBestMove(position, id);
      expect(move, id).not.toBeNull();
    }
  });

  test("without ever needing the book", () => {
    for (const id of PERSONALITY_ORDER) {
      expect(findBestMove(START, id, [], { book: false }), id).not.toBeNull();
    }
  });
});

describe("the Rookie", () => {
  test("plays a different move nearly every time", () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const move = findBestMove(START, "rookie");
      seen.add(`${move!.from}-${move!.to}`);
    }

    // Twenty moves are available; a bot playing at random should find well
    // more than a handful of them in sixty tries.
    expect(seen.size).toBeGreaterThan(8);
  });

  test("and misses a free queen, which a searching bot does not", () => {
    // The black queen on d5 is hanging to the rook on d2.
    const position = parseFen("k7/8/8/3q4/8/8/3R4/K7 w - - 0 1");

    const rookieTakes = Array.from({ length: 40 }, () =>
      toAlgebraic(findBestMove(position, "rookie")!.to),
    ).filter((square) => square === "d5").length;

    // It has no reason to prefer the capture, so it should mostly not play it.
    expect(rookieTakes).toBeLessThan(20);
    expect(toAlgebraic(findBestMove(position, "maestro")!.to)).toBe("d5");
  });
});

describe("a slip", () => {
  test("is taken when the draw comes in under the chance", () => {
    // `random` is consumed first by the slip check and then to pick the move,
    // so a draw of 0 slips and lands on the first legal move.
    const move = findBestMove(START, "gambiteer", [], { random: () => 0 });
    const first = generateLegalMoves(START)[0]!;

    expect(move!.from).toBe(first.from);
    expect(move!.to).toBe(first.to);
  });

  test("and never by a bot with no chance of one", () => {
    // The Maestro slips with probability zero, so even a draw of 0 has to
    // reach the book or the search rather than a random move.
    const position = parseFen("6k1/5ppp/8/8/8/8/8/R6K w - - 0 1");
    const move = findBestMove(position, "maestro", [], { random: () => 0 });

    expect(toAlgebraic(move!.to)).toBe("a8");
  });
});

describe("what a bot values", () => {
  /** White is a pawn down but far better developed. */
  const gambit = parseFen(
    "rnbqkbnr/ppp1pppp/8/8/2BpP3/5N2/PPP2PPP/RNBQK2R b KQkq - 1 4",
  );

  test("the house evaluation is the default", () => {
    expect(evaluate(gambit)).toBe(evaluate(gambit, DEFAULT_EVAL_WEIGHTS));
  });

  test("the Gambiteer minds being a pawn down less than the Fortress", () => {
    // Scores are from the side to move's point of view, and black is the one
    // holding the extra pawn — so a bot that cares about material scores this
    // *higher* for black than one that cares about activity does.
    const byGambiteer = evaluate(gambit, PERSONALITIES.gambiteer.weights);
    const byFortress = evaluate(gambit, PERSONALITIES.fortress.weights);

    expect(byFortress).toBeGreaterThan(byGambiteer);
  });

  /** The house weights with one term moved, so a test can isolate that term. */
  function only(term: keyof typeof DEFAULT_EVAL_WEIGHTS, value: number) {
    return { ...DEFAULT_EVAL_WEIGHTS, [term]: value };
  }

  test("the king-safety weight reaches the pawn shield", () => {
    // Two rooks and a queen a side, so the position is still a middlegame —
    // the shield term is midgame-only, and with bare kings it would be worth
    // nothing whatever the weight said. White's g-pawn has left the shield.
    const holed = parseFen("r2q1rk1/5ppp/8/8/6P1/8/5P1P/R2Q1RK1 w - - 0 1");

    expect(evaluate(holed, only("kingSafety", 2))).toBeLessThan(
      evaluate(holed, only("kingSafety", 0.5)),
    );
  });

  test("the material weight reaches the piece values", () => {
    // Black is the one holding the extra pawn, and scores are from the side to
    // move's point of view — so caring more about material scores this higher.
    expect(evaluate(gambit, only("material", 1.5))).toBeGreaterThan(
      evaluate(gambit, only("material", 0.5)),
    );
  });

  test("the passed-pawn weight reaches passed pawns", () => {
    const passed = parseFen("4k3/8/8/4P3/8/8/8/4K3 w - - 0 1");

    expect(evaluate(passed, only("passedPawns", 2))).toBeGreaterThan(
      evaluate(passed, only("passedPawns", 0.5)),
    );
  });

  test("and the bots are set up to disagree about all three", () => {
    const { gambiteer, fortress, grinder } = PERSONALITIES;

    expect(fortress.weights.material).toBeGreaterThan(gambiteer.weights.material);
    expect(fortress.weights.kingSafety).toBeGreaterThan(gambiteer.weights.kingSafety);
    expect(grinder.weights.passedPawns).toBeGreaterThan(
      DEFAULT_EVAL_WEIGHTS.passedPawns,
    );
  });

  test("scaling every weight together changes nothing anyone can see", () => {
    // Only ratios matter, which is worth pinning: it is the property that makes
    // these numbers tunable one at a time.
    const doubled = Object.fromEntries(
      Object.entries(DEFAULT_EVAL_WEIGHTS).map(([key, value]) => [key, value * 2]),
    ) as typeof DEFAULT_EVAL_WEIGHTS;

    expect(evaluate(gambit, doubled)).toBe(evaluate(gambit) * 2);
  });
});

describe("contempt", () => {
  /** Bare kings: every line from here is a draw by insufficient material. */
  const drawn = parseFen("k7/8/8/8/8/8/8/K7 w - - 0 1");

  test("scores a dead draw as dead level by default", () => {
    // Compared rather than matched, because negating a zero score produces a
    // negative zero, and `toBe` can tell those apart where chess cannot.
    expect(search(drawn, { depth: 2 }).score === 0).toBe(true);
  });

  test("a bot that hates draws scores one below zero", () => {
    expect(search(drawn, { depth: 2, contempt: 50 }).score).toBe(-50);
  });

  test("and one that is happy with them scores it above", () => {
    expect(search(drawn, { depth: 2, contempt: -50 }).score).toBe(50);
  });

  test("the Grinder plays on where the Fortress would shake hands", () => {
    expect(PERSONALITIES.grinder.contempt).toBeGreaterThan(0);
    expect(PERSONALITIES.fortress.contempt).toBeLessThan(0);
  });
});

describe("opening taste", () => {
  /** The game after a line of SAN from the initial array. */
  function after(...sans: string[]) {
    let game = createGame();
    for (const san of sans) {
      game = play(game, findSanMove(game, san)!);
    }
    return game;
  }

  const openGame = after("e4", "e5");

  /**
   * How often `style` lands on `san`, over a ticket swept evenly across the
   * whole range. Sweeping rather than sampling `Math.random` makes this an
   * exact reading of the weighting instead of a coin toss with a threshold.
   */
  function shareOf(san: string, style: "gambit" | "solid" | null): number {
    const wanted = findSanMove(openGame, san)!;
    const samples = 400;
    let hits = 0;

    for (let index = 0; index < samples; index += 1) {
      const move = chooseBookMove(openGame.position, {
        random: () => index / samples,
        style,
      });
      if (move && move.from === wanted.from && move.to === wanted.to) {
        hits += 1;
      }
    }

    return hits / samples;
  }

  test("the position after 1.e4 e5 really does offer a gambit", () => {
    expect(bookMoves(openGame.position).map((entry) => entry.san)).toContain("f4");
  });

  test("asking for gambits pulls the book towards the King's Gambit", () => {
    const biased = shareOf("f4", "gambit");
    const straight = shareOf("f4", null);

    expect(biased).toBeGreaterThan(straight);
  });

  test("asking for solid lines pushes it away from one", () => {
    expect(shareOf("f4", "solid")).toBeLessThan(shareOf("f4", null));
  });

  test("but never leaves the book with no answer at all", () => {
    for (const style of ["gambit", "solid", "sharp", "classical"] as const) {
      for (let index = 0; index < 20; index += 1) {
        const move = chooseBookMove(START, {
          random: () => index / 20,
          style,
        });
        expect(move, `${style} ${index}`).not.toBeNull();
      }
    }
  });
});
