import { z } from "@hono/zod-openapi";

import { pliesToTakeBack } from "../game/rules";

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

export const API_PATHS = {
  root: "/api",
  games: "/api/games",
  puzzles: "/api/puzzles",
  repertoire: "/api/repertoire",
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

export const selfLinksSchema = z
  .object({ self: linkSchema })
  .openapi("SelfLinks");

export const gameLinksSchema = z
  .object({
    self: linkSchema,
    moves: linkSchema.optional(),
    resign: linkSchema.optional(),
    abort: linkSchema.optional(),
    claim: linkSchema.optional(),
    flag: linkSchema.optional(),
    offerDraw: linkSchema.optional(),
    acceptDraw: linkSchema.optional(),
    declineDraw: linkSchema.optional(),
    takeback: linkSchema.optional(),
    acceptTakeback: linkSchema.optional(),
    declineTakeback: linkSchema.optional(),
    say: linkSchema.optional(),
  })
  .openapi("GameLinks");

export type GameLinks = z.infer<typeof gameLinksSchema>;

type GameState = {
  id: string;
  mode: "AI" | "PVP";
  yourColor: "w" | "b";
  turn: "w" | "b";
  ply: number;
  result: string | null;
  clock: object | null;
  drawOfferFrom: "w" | "b" | null;
  takebackOfferFrom: "w" | "b" | null;
};

export function gameLinks(game: GameState): GameLinks {
  const base = `${API_PATHS.games}/${game.id}`;
  const live = game.result === null;
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
    ...(live &&
    pliesToTakeBack(game.ply, game.yourColor) !== null &&
    game.takebackOfferFrom !== game.yourColor
      ? { takeback: post(`${base}/takeback`) }
      : {}),
    ...(live &&
    game.mode === "PVP" &&
    game.takebackOfferFrom !== null &&
    game.takebackOfferFrom !== game.yourColor
      ? { acceptTakeback: post(`${base}/takeback/accept`) }
      : {}),
    ...(live && game.mode === "PVP" && game.takebackOfferFrom !== null
      ? { declineTakeback: del(`${base}/takeback`) }
      : {}),
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
    moves: linkSchema.optional(),
    hint: linkSchema.optional(),
    reveal: linkSchema.optional(),
  })
  .openapi("PuzzleLinks");

export type PuzzleLinks = z.infer<typeof puzzleLinksSchema>;

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
    accept: linkSchema.optional(),
    decline: linkSchema.optional(),
    cancel: linkSchema.optional(),
    game: linkSchema.optional(),
  })
  .openapi("ChallengeLinks");

export type ChallengeLinks = z.infer<typeof challengeLinksSchema>;

type ChallengeState = {
  id: string;
  status: string;
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
    profile: linkSchema,
    accept: linkSchema.optional(),
    decline: linkSchema.optional(),
    remove: linkSchema.optional(),
    challenge: linkSchema.optional(),
  })
  .openapi("FriendLinks");

export type FriendLinks = z.infer<typeof friendLinksSchema>;

type FriendState = {
  id: string;
  username: string;
  status: string;
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
    addFriend: linkSchema.optional(),
    acceptFriend: linkSchema.optional(),
    declineFriend: linkSchema.optional(),
    removeFriend: linkSchema.optional(),
    challenge: linkSchema.optional(),
  })
  .openapi("PlayerLinks");

export type PlayerLinks = z.infer<typeof playerLinksSchema>;

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
    purchase: linkSchema.optional(),
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
    next: linkSchema.optional(),
    prev: linkSchema.optional(),
  })
  .openapi("OffsetPageLinks");

export type OffsetPageLinks = z.infer<typeof offsetPageLinksSchema>;

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
