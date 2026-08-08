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
    method: z
      .enum(["GET", "POST", "PUT", "DELETE"])
      .openapi({ example: "GET" }),
  })
  .openapi("Link");

export type Link = z.infer<typeof linkSchema>;

/** The mounts `app.ts` gives each router, spelled once. */
export const API_PATHS = {
  root: "/api",
  games: "/api/games",
  puzzles: "/api/puzzles",
  challenges: "/api/challenges",
  friends: "/api/friends",
  players: "/api/players",
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
    /** Present in a live PvP game with no offer of yours already standing. */
    offerDraw: linkSchema.optional(),
    /** Present only while the opponent's draw offer is yours to take. */
    acceptDraw: linkSchema.optional(),
    /** Present whenever an offer stands, from either side: yours to withdraw,
     * or theirs to decline. */
    declineDraw: linkSchema.optional(),
    /** Present in any PvP game, settled or not — "good game" is said after the
     * result, not before it. Absent against the bot, which has nothing to say. */
    say: linkSchema.optional(),
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
  /** The side with a draw offer standing, or null when none is. */
  drawOfferFrom: "w" | "b" | null;
};

export function gameLinks(game: GameState): GameLinks {
  const base = `${API_PATHS.games}/${game.id}`;
  const live = game.result === null;
  // Whether `abortGame` would allow it, spelled the way that handler spells it.
  // A link is an affordance, so one the handler answers with a 409 is worse than
  // no link at all — the client renders "abort" and the keypress fails.
  //
  // The two modes genuinely differ. Against the bot the rule is your *own* first
  // move, counted off the ply: white moves on the even plies, so after `ply`
  // half-moves white has played ceil(ply / 2) and black floor(ply / 2) — which
  // is how the bot's opening move, on the row from birth when it drew white,
  // does not cost its opponent the escape hatch. In a PvP game the rule is the
  // board's first move by either side: an abort there is the way out of a match
  // nobody showed up to, and once your opponent has committed a move it is a
  // game to resign rather than one to walk away from.
  const abortable =
    game.mode === "AI"
      ? (game.yourColor === "w"
          ? Math.ceil(game.ply / 2)
          : Math.floor(game.ply / 2)) === 0
      : game.ply === 0;

  return {
    self: get(base),
    ...(live && game.turn === game.yourColor
      ? { moves: post(`${base}/moves`) }
      : {}),
    ...(live ? { resign: post(`${base}/resign`) } : {}),
    ...(live && abortable ? { abort: post(`${base}/abort`) } : {}),
    ...(live && game.mode === "PVP" && game.turn !== game.yourColor
      ? { claim: post(`${base}/claim`) }
      : {}),
    ...(live && game.clock !== null ? { flag: post(`${base}/flag`) } : {}),
    // Draws are agreed, so all three are PvP-only. Offering is pointless while
    // your own offer already stands, and accepting only means something when the
    // offer on the table is the opponent's — so each link is present exactly
    // when there is something for it to do.
    ...(live && game.mode === "PVP" && game.drawOfferFrom !== game.yourColor
      ? { offerDraw: post(`${base}/draw`) }
      : {}),
    ...(live &&
    game.mode === "PVP" &&
    game.drawOfferFrom !== null &&
    game.drawOfferFrom !== game.yourColor
      ? { acceptDraw: post(`${base}/draw/accept`) }
      : {}),
    ...(live && game.mode === "PVP" && game.drawOfferFrom !== null
      ? { declineDraw: del(`${base}/draw`) }
      : {}),
    // Not gated on `live`, unlike everything above it. The customary exchange
    // of "good game" happens once the result is in, and a link that vanished at
    // the moment the game ended would take the feature away exactly when it is
    // wanted. The handler still enforces the per-player message cap.
    ...(game.mode === "PVP" ? { say: post(`${base}/chat`) } : {}),
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
  return {
    ...summary,
    _links: { self: get(`${API_PATHS.games}/${summary.id}`) },
  };
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

/**
 * The same links for the puzzle pinned to a Rush run.
 *
 * A run's puzzle is solved through the run's own endpoints, not the puzzle's —
 * a move there has to score the run, and `/puzzles/{id}/moves` would settle it
 * as a rated attempt instead. So the puzzle is handed over marked `attempted`,
 * which is exactly the flag that withholds those links.
 */
export function withRushPuzzleLinks<
  T extends { puzzle: { id: string; attempted: boolean } | null },
>(run: T): T & { puzzle: (T["puzzle"] & { _links: PuzzleLinks }) | null } {
  return {
    ...run,
    puzzle: run.puzzle
      ? withPuzzleLinks({ ...run.puzzle, attempted: true })
      : null,
  } as T & { puzzle: (T["puzzle"] & { _links: PuzzleLinks }) | null };
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

export const friendLinksSchema = z
  .object({
    /** Their profile. Always present — a row names a player. */
    profile: linkSchema,
    /** Present on a pending request addressed to you. */
    accept: linkSchema.optional(),
    /** Present on a pending request addressed to you. */
    decline: linkSchema.optional(),
    /** Withdraw a request you sent, or unfriend. One route, either reading. */
    remove: linkSchema.optional(),
    /** Present on an accepted friendship: someone you may play. */
    challenge: linkSchema.optional(),
  })
  .openapi("FriendLinks");

export type FriendLinks = z.infer<typeof friendLinksSchema>;

/** The slice of a friend row the links are decided from. */
type FriendState = {
  id: string;
  username: string;
  status: string;
  /** Whether the caller is the one who sent the request. */
  outgoing: boolean;
};

export function withFriendLinks<T extends FriendState>(
  friend: T,
): T & { _links: FriendLinks } {
  const base = `${API_PATHS.friends}/${friend.id}`;
  const pending = friend.status === "PENDING";

  return {
    ...friend,
    _links: {
      profile: get(`${API_PATHS.players}/${friend.username}`),
      ...(pending && !friend.outgoing
        ? { accept: post(`${base}/accept`), decline: post(`${base}/decline`) }
        : {}),
      // Present on a request you sent (withdraw) and on a friendship (unfriend),
      // and absent on one addressed to you — that one is declined, not withdrawn.
      ...(!pending || friend.outgoing ? { remove: del(base) } : {}),
      ...(friend.status === "ACCEPTED"
        ? { challenge: post(API_PATHS.challenges) }
        : {}),
    },
  };
}

export const playerLinksSchema = z
  .object({
    self: linkSchema,
    /** Present when there is no live friendship or request between you. */
    addFriend: linkSchema.optional(),
    /** Present when their request is yours to answer. */
    acceptFriend: linkSchema.optional(),
    declineFriend: linkSchema.optional(),
    /** Present on a friendship, or on a request of yours still standing. */
    removeFriend: linkSchema.optional(),
    /** Absent on your own profile — there is nobody there to play. */
    challenge: linkSchema.optional(),
  })
  .openapi("PlayerLinks");

export type PlayerLinks = z.infer<typeof playerLinksSchema>;

/** The slice of a public profile the links are decided from. */
type PlayerState = {
  username: string;
  friendship: { state: string; friendshipId: string | null };
};

export function withPlayerLinks<T extends PlayerState>(
  player: T,
): T & { _links: PlayerLinks } {
  const { state, friendshipId } = player.friendship;
  const friendship = friendshipId
    ? `${API_PATHS.friends}/${friendshipId}`
    : null;

  return {
    ...player,
    _links: {
      self: get(`${API_PATHS.players}/${player.username}`),
      ...(state === "none" ? { addFriend: post(API_PATHS.friends) } : {}),
      ...(state === "requestReceived" && friendship
        ? {
            acceptFriend: post(`${friendship}/accept`),
            declineFriend: post(`${friendship}/decline`),
          }
        : {}),
      ...((state === "friends" || state === "requestSent") && friendship
        ? { removeFriend: del(friendship) }
        : {}),
      ...(state === "self" ? {} : { challenge: post(API_PATHS.challenges) }),
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
    friends: linkSchema,
    addFriend: linkSchema,
    searchPlayers: linkSchema,
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
    friends: get(API_PATHS.friends),
    addFriend: post(API_PATHS.friends),
    searchPlayers: get(API_PATHS.players),
    nextPuzzle: get(`${API_PATHS.puzzles}/next`),
    dailyPuzzle: get(`${API_PATHS.puzzles}/daily`),
    profile: get(API_PATHS.me),
    achievements: get(API_PATHS.achievements),
    store: get(API_PATHS.titles),
    leaderboard: get(API_PATHS.leaderboard),
    health: get(API_PATHS.health),
  };
}
