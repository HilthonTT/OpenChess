/** Chess rules engine types. Pure data — no rendering or terminal concerns. */

export type Color = "w" | "b";

/** Lowercase piece kind, as used in FEN for black pieces. */
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

/** A piece in FEN notation: uppercase is white, lowercase is black. */
export type Piece =
  | "P"
  | "N"
  | "B"
  | "R"
  | "Q"
  | "K"
  | "p"
  | "n"
  | "b"
  | "r"
  | "q"
  | "k";

/** The empty square sentinel. */
export const EMPTY = "";

/** What sits on a square: a piece, or nothing. */
export type SquareContent = Piece | typeof EMPTY;

/**
 * 64 squares in FEN reading order: index 0 is a8, index 63 is h1. Use the
 * helpers in `board.ts` rather than doing index math inline.
 */
export type Board = SquareContent[];

export type CastlingRights = {
  whiteKingSide: boolean;
  whiteQueenSide: boolean;
  blackKingSide: boolean;
  blackQueenSide: boolean;
};

/**
 * The files the king and each rook began the game on, 0 for the a-file.
 *
 * Standard chess is 4/0/7 and the rest of the engine could have hard-coded it —
 * which is exactly what made Chess960 a rewrite everywhere instead of a setting.
 * Castling is the only rule that cares where a piece *started*, so this is the
 * one fact a position has to carry that a board cannot show: by the time the
 * king has moved once, "which rook was the h-rook" is no longer readable off
 * the squares.
 *
 * Held per colour even though every legal position has the two armies mirrored,
 * because a hand-written FEN need not: a puzzle may hand us castling rights for
 * one side and put the other side's king in the middle of the board. Reading
 * one side's files off the other's would then invent a castling move nobody has.
 */
export type CastlingFiles = {
  king: number;
  /** The rook that starts left of the king — the one `O-O-O` uses. */
  queenRook: number;
  /** The rook that starts right of the king — the one `O-O` uses. */
  kingRook: number;
};

/** `CastlingFiles` for each side. */
export type CastlingSetup = Record<Color, CastlingFiles>;

/** A complete, self-contained chess position — everything a FEN encodes. */
export type Position = {
  board: Board;
  turn: Color;
  castling: CastlingRights;
  /**
   * Where castling starts from, per colour. Standard chess for anything parsed
   * from an ordinary FEN; see `CastlingFiles`.
   */
  castlingFiles: CastlingSetup;
  /**
   * The square a pawn just skipped over on a double push (the square a capturing
   * pawn would land on), or null. Set whenever a double push happens, matching
   * FEN's definition rather than the "only if capturable" variant.
   */
  enPassant: number | null;
  /** Plies since the last capture or pawn move; 100 means the fifty-move rule applies. */
  halfmoveClock: number;
  fullmoveNumber: number;
};

export type PromotionPiece = "q" | "r" | "b" | "n";

export type CastleSide = "king" | "queen";

export type Move = {
  from: number;
  to: number;
  piece: Piece;
  /** The captured piece, including the pawn taken en passant. */
  captured: Piece | null;
  promotion: PromotionPiece | null;
  isEnPassant: boolean;
  isCastle: CastleSide | null;
  isDoublePawnPush: boolean;
};

export type GameStatus =
  | "playing"
  | "check"
  | "checkmate"
  | "stalemate"
  | "draw-fifty-move"
  | "draw-repetition"
  | "draw-insufficient-material";
