export type Color = "w" | "b";

export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

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

export const EMPTY = "";

export type SquareContent = Piece | typeof EMPTY;

export type Board = SquareContent[];

export type CastlingRights = {
  whiteKingSide: boolean;
  whiteQueenSide: boolean;
  blackKingSide: boolean;
  blackQueenSide: boolean;
};

export type CastlingFiles = {
  king: number;
  queenRook: number;
  kingRook: number;
};

export type CastlingSetup = Record<Color, CastlingFiles>;

export type Position = {
  board: Board;
  turn: Color;
  castling: CastlingRights;
  castlingFiles: CastlingSetup;
  enPassant: number | null;
  halfmoveClock: number;
  fullmoveNumber: number;
};

export type PromotionPiece = "q" | "r" | "b" | "n";

export type CastleSide = "king" | "queen";

export type Move = {
  from: number;
  to: number;
  piece: Piece;
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
