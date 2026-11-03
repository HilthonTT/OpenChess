const KNIGHT =
  "M30 88H74V80L68 78C70 62 72 46 64 32C58 22 48 16 40 16L38 10L34 17C28 20 22 28 18 38L16 46C16 50 20 53 24 52L34 48C38 47 42 46 44 44C42 54 36 62 34 72L32 78L28 80Z";

/** The OpenChess mark from assets/logo.svg, plus the wordmark. */
export function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 128 128" className="logo-mark" aria-hidden="true">
        <defs>
          <clipPath id="logo-tile">
            <rect width="128" height="128" rx="28" />
          </clipPath>
        </defs>
        <g clipPath="url(#logo-tile)">
          <rect width="128" height="128" fill="#14100B" />
          <path
            fill="#221B13"
            d="M0 0h32v32H0zM64 0h32v32H64zM32 32h32v32H32zM96 32h32v32H96zM0 64h32v32H0zM64 64h32v32H64zM32 96h32v32H32zM96 96h32v32H96z"
          />
        </g>
        <g transform="translate(10 14) scale(0.92)">
          <path fill="#B58863" transform="translate(4 3)" d={KNIGHT} />
          <path fill="#F0D9B5" d={KNIGHT} />
          <circle cx="35" cy="28" r="3" fill="#14100B" />
        </g>
        <rect x="88" y="89" width="18" height="8" rx="2" fill="#E2B45A" />
      </svg>
      <span className="logo-word">
        Open<span className="accent">Chess</span>
      </span>
    </span>
  );
}
