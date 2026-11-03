import type { Piece as PieceCode } from "@openchess/shared";

// Flat silhouettes in the same style as the OpenChess knight: cream on an
// ink outline for White, ink on cream detail for Black.
const BASE = <rect x="25" y="80" width="50" height="10" rx="3" />;

const SHAPES: Record<string, (detail: string) => React.ReactNode> = {
  p: () => (
    <>
      <path d="M35 82C35 70 40 60 44 53H56C60 60 65 70 65 82Z" />
      <circle cx="50" cy="38" r="13" />
      {BASE}
    </>
  ),
  r: () => (
    <>
      <path d="M33 82L36 46H64L67 82Z" />
      <path d="M28 46V22H38V30H45V22H55V30H62V22H72V46Z" />
      {BASE}
    </>
  ),
  n: (detail) => (
    <>
      <path
        transform="translate(5 1)"
        d="M30 88H74V80L68 78C70 62 72 46 64 32C58 22 48 16 40 16L38 10L34 17C28 20 22 28 18 38L16 46C16 50 20 53 24 52L34 48C38 47 42 46 44 44C42 54 36 62 34 72L32 78L28 80Z"
      />
      <circle cx="40" cy="29" r="3" fill={detail} stroke="none" />
    </>
  ),
  b: (detail) => (
    <>
      <path d="M36 82C36 72 42 66 44 60H56C58 66 64 72 64 82Z" />
      <path d="M50 18C40 27 34 36 34 46C34 55 41 61 50 61C59 61 66 55 66 46C66 36 60 27 50 18Z" />
      <circle cx="50" cy="14" r="5" />
      <path d="M55 32L46 45" stroke={detail} fill="none" />
      {BASE}
    </>
  ),
  q: () => (
    <>
      <path d="M33 82L37 56H63L67 82Z" />
      <path d="M22 32L33 58H67L78 32L67 46L63 26L57 44L50 22L43 44L37 26L33 46Z" />
      <circle cx="22" cy="30" r="4.5" />
      <circle cx="37" cy="24" r="4.5" />
      <circle cx="50" cy="19" r="4.5" />
      <circle cx="63" cy="24" r="4.5" />
      <circle cx="78" cy="30" r="4.5" />
      {BASE}
    </>
  ),
  k: (detail) => (
    <>
      <path d="M33 82L37 56H63L67 82Z" />
      <path d="M30 58C22 46 28 34 40 37C44 31 56 31 60 37C72 34 78 46 70 58Z" />
      <path d="M46 8H54V15H61V23H54V32H46V23H39V15H46Z" />
      <path d="M50 38V54" stroke={detail} fill="none" />
      {BASE}
    </>
  ),
};

export function Piece({ piece }: { piece: PieceCode }) {
  const white = piece === piece.toUpperCase();
  const shape = SHAPES[piece.toLowerCase()];
  return (
    <svg
      viewBox="0 0 100 100"
      className={`piece ${white ? "piece-w" : "piece-b"}`}
      aria-hidden="true"
    >
      <g
        fill={white ? "var(--piece-w)" : "var(--piece-b)"}
        stroke={white ? "var(--piece-w-line)" : "var(--piece-b-line)"}
        strokeWidth="3.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {shape?.(white ? "var(--piece-w-line)" : "var(--piece-b-detail)")}
      </g>
    </svg>
  );
}
