/**
 * Puzzle themes.
 *
 * A stored puzzle's `themes` are free-form strings, because they arrive with an
 * imported corpus and the corpus decides what it tags. This is the display side
 * of that: the ones worth naming, what to call them, and which of them a player
 * would sensibly ask to train.
 *
 * The keys are Lichess's, since that is where the corpus comes from. Nothing
 * here is authoritative — a theme not in this list still filters and still
 * shows, it just shows under its raw key. That is deliberate: a catalog that
 * silently dropped unknown themes would make a freshly imported corpus look
 * half-empty.
 *
 * @see https://database.lichess.org/#puzzles
 */

export type PuzzleThemeGroup = "motif" | "mate" | "phase" | "length" | "goal";

export type PuzzleTheme = {
  /** The tag as it appears in a puzzle's `themes`. */
  key: string;
  label: string;
  group: PuzzleThemeGroup;
  /**
   * Whether it makes sense to train this one on its own. The motifs and the
   * mating patterns do; "crushing" and "middlegame" describe a puzzle rather
   * than name a thing to practise, so they are shown but not offered.
   */
  trainable: boolean;
};

function theme(
  key: string,
  label: string,
  group: PuzzleThemeGroup,
  trainable = true,
): PuzzleTheme {
  return { key, label, group, trainable };
}

export const PUZZLE_THEMES: readonly PuzzleTheme[] = [
  // The tactical motifs — what a trainer is actually for.
  theme("fork", "Fork", "motif"),
  theme("pin", "Pin", "motif"),
  theme("skewer", "Skewer", "motif"),
  theme("discoveredAttack", "Discovered attack", "motif"),
  theme("doubleCheck", "Double check", "motif"),
  theme("deflection", "Deflection", "motif"),
  theme("attraction", "Attraction", "motif"),
  theme("clearance", "Clearance", "motif"),
  theme("interference", "Interference", "motif"),
  theme("intermezzo", "Zwischenzug", "motif"),
  theme("xRayAttack", "X-ray attack", "motif"),
  theme("zugzwang", "Zugzwang", "motif"),
  theme("sacrifice", "Sacrifice", "motif"),
  theme("hangingPiece", "Hanging piece", "motif"),
  theme("trappedPiece", "Trapped piece", "motif"),
  theme("attackingF2F7", "Attacking f2 / f7", "motif"),
  theme("capturingDefender", "Capturing the defender", "motif"),
  theme("defensiveMove", "Defensive move", "motif"),
  theme("quietMove", "Quiet move", "motif"),
  theme("advancedPawn", "Advanced pawn", "motif"),
  theme("promotion", "Promotion", "motif"),
  theme("underPromotion", "Underpromotion", "motif"),
  theme("enPassant", "En passant", "motif"),
  theme("castling", "Castling", "motif"),
  theme("exposedKing", "Exposed king", "motif"),
  theme("kingsideAttack", "Kingside attack", "motif"),
  theme("queensideAttack", "Queenside attack", "motif"),
  theme("pawnEndgame", "Pawn endgame", "motif"),
  theme("rookEndgame", "Rook endgame", "motif"),
  theme("queenEndgame", "Queen endgame", "motif"),
  theme("bishopEndgame", "Bishop endgame", "motif"),
  theme("knightEndgame", "Knight endgame", "motif"),
  theme("queenRookEndgame", "Queen and rook endgame", "motif"),

  // Mating patterns.
  theme("mate", "Mate", "mate"),
  theme("mateIn1", "Mate in 1", "mate"),
  theme("mateIn2", "Mate in 2", "mate"),
  theme("mateIn3", "Mate in 3", "mate"),
  theme("mateIn4", "Mate in 4", "mate"),
  theme("mateIn5", "Mate in 5 or more", "mate"),
  theme("backRankMate", "Back-rank mate", "mate"),
  theme("smotheredMate", "Smothered mate", "mate"),
  theme("anastasiaMate", "Anastasia's mate", "mate"),
  theme("arabianMate", "Arabian mate", "mate"),
  theme("bodenMate", "Boden's mate", "mate"),
  theme("doubleBishopMate", "Double bishop mate", "mate"),
  theme("dovetailMate", "Dovetail mate", "mate"),
  theme("hookMate", "Hook mate", "mate"),

  // What the puzzle is worth, and where it comes from. Shown, not trained.
  theme("opening", "Opening", "phase", false),
  theme("middlegame", "Middlegame", "phase", false),
  theme("endgame", "Endgame", "phase", false),
  theme("oneMove", "One move", "length", false),
  theme("short", "Short", "length", false),
  theme("long", "Long", "length", false),
  theme("veryLong", "Very long", "length", false),
  theme("advantage", "Advantage", "goal", false),
  theme("crushing", "Crushing", "goal", false),
  theme("equality", "Equality", "goal", false),
  theme("master", "From a master game", "goal", false),
  theme("masterVsMaster", "Master vs master", "goal", false),
  theme("superGM", "Super GM game", "goal", false),
];

const BY_KEY = new Map(PUZZLE_THEMES.map((entry) => [entry.key, entry]));

/** The catalog entry for `key`, or null when the corpus tagged something new. */
export function findPuzzleTheme(key: string): PuzzleTheme | null {
  return BY_KEY.get(key) ?? null;
}

/**
 * What to show a theme as. Falls back to un-camel-casing the raw key, so a
 * theme the catalog has never heard of still reads as words rather than as
 * `queenRookEndgame`.
 */
export function puzzleThemeLabel(key: string): string {
  const known = BY_KEY.get(key);
  if (known) {
    return known.label;
  }

  const spaced = key.replace(/([a-z\d])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The themes worth offering as something to train. */
export const TRAINABLE_PUZZLE_THEMES: readonly PuzzleTheme[] =
  PUZZLE_THEMES.filter((entry) => entry.trainable);

export function isTrainablePuzzleTheme(key: string): boolean {
  return BY_KEY.get(key)?.trainable ?? false;
}
