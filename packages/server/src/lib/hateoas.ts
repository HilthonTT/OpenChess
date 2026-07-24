import { z } from "@hono/zod-openapi";

/**
 * HATEOAS `_links`.
 *
 * Each resource carries a `_links` member naming the requests that make sense
 * against it right now — an action's link is present exactly when the
 * resource's own state says the action is available, and absent otherwise, so
 * a client can render "what can I do here" straight off the response instead
 * of re-deriving the game rules. Presence is an affordance, not a promise:
 * conditions the server checks against the clock (a five-minute absence, a
 * fallen flag) move on their own, and the handler behind a link still
 * enforces them.
 *
 * Hrefs are server-relative and carry the `/api` prefix the routers are
 * mounted under, so this module is the one place besides `app.ts` that spells
 * the URL space out — `API_PATHS` below must mirror the mounts there.
 */

export const linkSchema = z
  .object({
    href: z
      .string()
      .openapi({ example: "/api/games/clx0h2k9r0000abcd1234efgh" }),
    method: z.enum(["GET", "POST", "PUT", "DELETE"]).openapi({ example: "GET" }),
  })
  .openapi("Link");

export type Link = z.infer<typeof linkSchema>;

/** The mounts `app.ts` gives each router, spelled once. */
export const API_PATHS = {
  root: "/api",
  games: "/api/games",
  puzzles: "/api/puzzles",
  challenges: "/api/challenges",
  me: "/api/me",
  titles: "/api/titles",
  achievements: "/api/achievements",
  leaderboard: "/api/leaderboard",
  health: "/api/health",
} as const;

const get = (href: string): Link => ({ href, method: "GET" });
const post = (href: string): Link => ({ href, method: "POST" });
const put = (href: string): Link => ({ href, method: "PUT" });
const del = (href: string): Link => ({ href, method: "DELETE" });

/** The one-member link object of resources that only point at themselves. */
export const selfLinksSchema = z
  .object({ self: linkSchema })
  .openapi("SelfLinks");

export const gameLinksSchema = z
  .object({
    self: linkSchema,
    /** Present exactly when it is your move in a live game. */
    moves: linkSchema.optional(),
    /** Present while the game is live. */
    resign: linkSchema.optional(),
    /** Present until you have played your own first move. */
    abort: linkSchema.optional(),
    /** Present in a live PvP game on your opponent's turn; whether their
     * five minutes of silence have elapsed is still the server's call. */
    claim: linkSchema.optional(),
    /** Present while a timed game is live; whether a flag has actually
     * fallen is still the server's call. */
    flag: linkSchema.optional(),
  })
  .openapi("GameLinks");

export type GameLinks = z.infer<typeof gameLinksSchema>;

/** The slice of a game view the links are decided from. */
type GameState = {
  id: string;
  mode: "AI" | "PVP";
  yourColor: "w" | "b";
  turn: "w" | "b";
  ply: number;
  result: string | null;
  clock: object | null;
};

export function gameLinks(game: GameState): GameLinks {
  const base = `${API_PATHS.games}/${game.id}`;
  const live = game.result === null;
  // White moves on the even plies, so after `ply` half-moves white has played
  // ceil(ply / 2) of them and black floor(ply / 2). Abort is only legal while
  // your own count is zero — which is how the bot's opening move in an AI game
  // does not cost you the escape hatch.
  const yourMoves =
    game.yourColor === "w" ? Math.ceil(game.ply / 2) : Math.floor(game.ply / 2);

  return {
    self: get(base),
    ...(live && game.turn === game.yourColor
      ? { moves: post(`${base}/moves`) }
      : {}),
    ...(live ? { resign: post(`${base}/resign`) } : {}),
    ...(live && yourMoves === 0 ? { abort: post(`${base}/abort`) } : {}),
    ...(live && game.mode === "PVP" && game.turn !== game.yourColor
      ? { claim: post(`${base}/claim`) }
      : {}),
    ...(live && game.clock !== null ? { flag: post(`${base}/flag`) } : {}),
  };
}

export function withGameLinks<T extends GameState>(
  game: T,
): T & { _links: GameLinks } {
  return { ...game, _links: gameLinks(game) };
}

export function withGameSummaryLinks<T extends { id: string }>(
  summary: T,
): T & { _links: { self: Link } } {
  return { ...summary, _links: { self: get(`${API_PATHS.games}/${summary.id}`) } };
}

/**
 * A row in the watch list points at the spectator view, not at `/games/{id}` —
 * a watcher is not a player in it, and following the player link would earn
 * them the 403 the game service is right to give.
 */
export function withLiveGameLinks<T extends { id: string }>(
  summary: T,
): T & { _links: { self: Link } } {
  return {
    ...summary,
    _links: { self: get(`${API_PATHS.games}/${summary.id}/watch`) },
  };
}

export const puzzleLinksSchema = z
  .object({
    self: linkSchema,
    /** Where a solver's moves go. Absent once the puzzle has been attempted. */
    moves: linkSchema.optional(),
    hint: linkSchema.optional(),
    reveal: linkSchema.optional(),
  })
  .openapi("PuzzleLinks");

export type PuzzleLinks = z.infer<typeof puzzleLinksSchema>;

/**
 * A puzzle already attempted for credit can still be replayed for practice —
 * the service allows it — but the actions that would settle it are dropped from
 * the links, because there is nothing left for them to settle.
 */
export function withPuzzleLinks<T extends { id: string; attempted: boolean }>(
  puzzle: T,
): T & { _links: PuzzleLinks } {
  const base = `${API_PATHS.puzzles}/${puzzle.id}`;

  return {
    ...puzzle,
    _links: {
      self: get(base),
      ...(puzzle.attempted
        ? {}
        : {
            moves: post(`${base}/moves`),
            hint: post(`${base}/hint`),
            reveal: post(`${base}/reveal`),
          }),
    },
  };
}

export const challengeLinksSchema = z
  .object({
    self: linkSchema,
    /** Present on a pending challenge addressed to you, or an open one. */
    accept: linkSchema.optional(),
    /** Present on a pending challenge addressed to you. */
    decline: linkSchema.optional(),
    /** Present on a pending challenge you sent. */
    cancel: linkSchema.optional(),
    /** The game it became, once accepted. */
    game: linkSchema.optional(),
  })
  .openapi("ChallengeLinks");

export type ChallengeLinks = z.infer<typeof challengeLinksSchema>;

/** The slice of a challenge view the links are decided from. */
type ChallengeState = {
  id: string;
  status: string;
  /** Whether the caller is the one who sent it. */
  outgoing: boolean;
  gameId: string | null;
};

export function withChallengeLinks<T extends ChallengeState>(
  challenge: T,
): T & { _links: ChallengeLinks } {
  const base = `${API_PATHS.challenges}/${challenge.id}`;
  const pending = challenge.status === "PENDING";

  return {
    ...challenge,
    _links: {
      self: get(base),
      ...(pending && !challenge.outgoing
        ? { accept: post(`${base}/accept`), decline: post(`${base}/decline`) }
        : {}),
      ...(pending && challenge.outgoing ? { cancel: del(base) } : {}),
      ...(challenge.gameId
        ? { game: get(`${API_PATHS.games}/${challenge.gameId}`) }
        : {}),
    },
  };
}

export const titleLinksSchema = z
  .object({
    /** Present when the title is on sale and you can actually complete the
     * purchase — not yet owned, affordable, and your level suffices. */
    purchase: linkSchema.optional(),
    /** Present when you own the title and it is not already displayed. */
    equip: linkSchema.optional(),
  })
  .openapi("TitleLinks");

export type TitleLinks = z.infer<typeof titleLinksSchema>;

export function withTitleLinks<
  T extends {
    id: string;
    owned: boolean;
    affordable: boolean;
    isPurchasable: boolean;
    equipped: boolean;
  },
>(title: T): T & { _links: TitleLinks } {
  return {
    ...title,
    _links: {
      ...(title.isPurchasable && !title.owned && title.affordable
        ? { purchase: post(`${API_PATHS.titles}/${title.id}/purchase`) }
        : {}),
      ...(title.owned && !title.equipped
        ? { equip: put(`${API_PATHS.me}/title`) }
        : {}),
    },
  };
}

export const profileLinksSchema = z
  .object({
    self: linkSchema,
    stats: linkSchema,
    achievements: linkSchema,
    titles: linkSchema,
    transactions: linkSchema,
    equipTitle: linkSchema,
    /** Always present: the call is idempotent per day, so it is never an
     * error to make it, and whether anything is owed is the server's call. */
    checkIn: linkSchema,
  })
  .openapi("ProfileLinks");

export type ProfileLinks = z.infer<typeof profileLinksSchema>;

export function withProfileLinks<T extends object>(
  profile: T,
): T & { _links: ProfileLinks } {
  return {
    ...profile,
    _links: {
      self: get(API_PATHS.me),
      stats: get(`${API_PATHS.me}/stats`),
      achievements: get(`${API_PATHS.me}/achievements`),
      titles: get(`${API_PATHS.me}/titles`),
      transactions: get(`${API_PATHS.me}/transactions`),
      equipTitle: put(`${API_PATHS.me}/title`),
      checkIn: post(`${API_PATHS.me}/check-in`),
    },
  };
}

export const transactionLinksSchema = z
  .object({
    /** The game the entry paid out for, when there is one. */
    game: linkSchema.optional(),
  })
  .openapi("TransactionLinks");

export function withTransactionLinks<T extends { gameId: string | null }>(
  transaction: T,
): T & { _links: z.infer<typeof transactionLinksSchema> } {
  return {
    ...transaction,
    _links: {
      ...(transaction.gameId
        ? { game: get(`${API_PATHS.games}/${transaction.gameId}`) }
        : {}),
    },
  };
}

export const pageLinksSchema = z
  .object({
    self: linkSchema,
    /** The next page; absent on the last one. Carries the same `nextCursor`
     * the body does, ready-made as a URL. */
    next: linkSchema.optional(),
  })
  .openapi("PageLinks");

export type PageLinks = z.infer<typeof pageLinksSchema>;

type QueryValue = string | number | undefined;

function withQuery(path: string, query: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Links for a cursor-paginated list: `self` reproduces the request as served,
 * `next` swaps in the cursor the page handed out.
 */
export function pageLinks(
  path: string,
  query: Record<string, QueryValue>,
  nextCursor: string | null,
): PageLinks {
  return {
    self: get(withQuery(path, query)),
    ...(nextCursor
      ? { next: get(withQuery(path, { ...query, cursor: nextCursor })) }
      : {}),
  };
}

export const offsetPageLinksSchema = z
  .object({
    self: linkSchema,
    /** Absent on the last page. */
    next: linkSchema.optional(),
    /** Absent on the first page. */
    prev: linkSchema.optional(),
  })
  .openapi("OffsetPageLinks");

export type OffsetPageLinks = z.infer<typeof offsetPageLinksSchema>;

/** Links for an offset-paginated list, the leaderboard's shape. */
export function offsetPageLinks(
  path: string,
  query: Record<string, QueryValue>,
  input: { page: number; limit: number; total: number },
): OffsetPageLinks {
  const { page, limit, total } = input;

  return {
    self: get(withQuery(path, { ...query, page })),
    ...(page * limit < total
      ? { next: get(withQuery(path, { ...query, page: page + 1 })) }
      : {}),
    ...(page > 1
      ? { prev: get(withQuery(path, { ...query, page: page - 1 })) }
      : {}),
  };
}

export const rootLinksSchema = z
  .object({
    self: linkSchema,
    docs: linkSchema,
    games: linkSchema,
    activeGames: linkSchema,
    liveGames: linkSchema,
    createGame: linkSchema,
    joinQueue: linkSchema,
    leaveQueue: linkSchema,
    challenges: linkSchema,
    createChallenge: linkSchema,
    nextPuzzle: linkSchema,
    dailyPuzzle: linkSchema,
    profile: linkSchema,
    achievements: linkSchema,
    store: linkSchema,
    leaderboard: linkSchema,
    health: linkSchema,
  })
  .openapi("RootLinks");

export type RootLinks = z.infer<typeof rootLinksSchema>;

/** The API's front door: every top-level resource, discoverable from `/api`. */
export function rootLinks(): RootLinks {
  return {
    self: get(API_PATHS.root),
    docs: get("/reference"),
    games: get(API_PATHS.games),
    activeGames: get(`${API_PATHS.games}/active`),
    liveGames: get(`${API_PATHS.games}/live`),
    createGame: post(API_PATHS.games),
    joinQueue: post(`${API_PATHS.games}/pvp/queue`),
    leaveQueue: del(`${API_PATHS.games}/pvp/queue`),
    challenges: get(API_PATHS.challenges),
    createChallenge: post(API_PATHS.challenges),
    nextPuzzle: get(`${API_PATHS.puzzles}/next`),
    dailyPuzzle: get(`${API_PATHS.puzzles}/daily`),
    profile: get(API_PATHS.me),
    achievements: get(API_PATHS.achievements),
    store: get(API_PATHS.titles),
    leaderboard: get(API_PATHS.leaderboard),
    health: get(API_PATHS.health),
  };
}
