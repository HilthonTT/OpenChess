import { describe, expect, test } from "bun:test";

import {
  gameLinks,
  offsetPageLinks,
  pageLinks,
  withTitleLinks,
} from "./hateoas";

/** A live, untimed AI game where you play white and are yet to move. */
function freshGame() {
  return {
    id: "game1",
    mode: "AI" as const,
    yourColor: "w" as const,
    turn: "w" as const,
    ply: 0,
    result: null,
    clock: null,
  };
}

describe("gameLinks", () => {
  test("a fresh game on your move offers moves, resign and abort", () => {
    const links = gameLinks(freshGame());

    expect(links.self).toEqual({ href: "/api/games/game1", method: "GET" });
    expect(links.moves).toEqual({
      href: "/api/games/game1/moves",
      method: "POST",
    });
    expect(links.resign).toBeDefined();
    expect(links.abort).toBeDefined();
    expect(links.claim).toBeUndefined();
    expect(links.flag).toBeUndefined();
  });

  test("a finished game offers nothing but itself", () => {
    const links = gameLinks({ ...freshGame(), result: "WHITE_WIN", turn: "b" });

    expect(links).toEqual({
      self: { href: "/api/games/game1", method: "GET" },
    });
  });

  test("no moves link when it is not your turn", () => {
    const links = gameLinks({ ...freshGame(), turn: "b", ply: 1 });

    expect(links.moves).toBeUndefined();
    expect(links.resign).toBeDefined();
  });

  test("abort survives the bot's opening move but not your own", () => {
    // You are black at ply 1: the bot opened, you have not moved.
    const botOpened = gameLinks({
      ...freshGame(),
      yourColor: "b",
      turn: "b",
      ply: 1,
    });
    expect(botOpened.abort).toBeDefined();

    // You are white at ply 2: your own first move is on the board.
    const youMoved = gameLinks({ ...freshGame(), ply: 2 });
    expect(youMoved.abort).toBeUndefined();
  });

  test("claim appears only in a live PvP game on the opponent's turn", () => {
    const theirs = gameLinks({
      ...freshGame(),
      mode: "PVP",
      turn: "b",
      ply: 1,
    });
    expect(theirs.claim).toEqual({
      href: "/api/games/game1/claim",
      method: "POST",
    });

    const yours = gameLinks({ ...freshGame(), mode: "PVP" });
    expect(yours.claim).toBeUndefined();

    const ai = gameLinks({ ...freshGame(), turn: "b", ply: 1 });
    expect(ai.claim).toBeUndefined();
  });

  test("flag appears only while a timed game is live", () => {
    const clock = {
      whiteMs: 1000,
      blackMs: 1000,
      turnStartedAt: "2026-01-01T00:00:00Z",
      running: "w",
    };

    expect(gameLinks({ ...freshGame(), clock }).flag).toEqual({
      href: "/api/games/game1/flag",
      method: "POST",
    });
    expect(gameLinks(freshGame()).flag).toBeUndefined();
    expect(
      gameLinks({ ...freshGame(), clock, result: "DRAW" }).flag,
    ).toBeUndefined();
  });
});

describe("withTitleLinks", () => {
  const title = {
    id: "t1",
    owned: false,
    affordable: true,
    isPurchasable: true,
    equipped: false,
  };

  test("a buyable title links to its purchase", () => {
    expect(withTitleLinks(title)._links).toEqual({
      purchase: { href: "/api/titles/t1/purchase", method: "POST" },
    });
  });

  test("an unaffordable title is listed without the purchase link", () => {
    expect(withTitleLinks({ ...title, affordable: false })._links).toEqual({});
  });

  test("an owned title links to equipping until it is displayed", () => {
    expect(withTitleLinks({ ...title, owned: true })._links).toEqual({
      equip: { href: "/api/me/title", method: "PUT" },
    });
    expect(
      withTitleLinks({ ...title, owned: true, equipped: true })._links,
    ).toEqual({});
  });
});

describe("pageLinks", () => {
  test("self reproduces the request and next swaps in the new cursor", () => {
    const links = pageLinks(
      "/api/games",
      { cursor: "old", limit: 20, result: undefined },
      "new",
    );

    expect(links.self.href).toBe("/api/games?cursor=old&limit=20");
    expect(links.next?.href).toBe("/api/games?cursor=new&limit=20");
  });

  test("the last page has no next", () => {
    expect(pageLinks("/api/games", { limit: 20 }, null).next).toBeUndefined();
  });
});

describe("offsetPageLinks", () => {
  const query = { sort: "rating", limit: 50 };

  test("a middle page links both ways", () => {
    const links = offsetPageLinks("/api/leaderboard", query, {
      page: 2,
      limit: 50,
      total: 120,
    });

    expect(links.self.href).toBe("/api/leaderboard?sort=rating&limit=50&page=2");
    expect(links.next?.href).toBe(
      "/api/leaderboard?sort=rating&limit=50&page=3",
    );
    expect(links.prev?.href).toBe(
      "/api/leaderboard?sort=rating&limit=50&page=1",
    );
  });

  test("the edges drop the link that would fall off the board", () => {
    const first = offsetPageLinks("/api/leaderboard", query, {
      page: 1,
      limit: 50,
      total: 120,
    });
    expect(first.prev).toBeUndefined();

    const last = offsetPageLinks("/api/leaderboard", query, {
      page: 3,
      limit: 50,
      total: 120,
    });
    expect(last.next).toBeUndefined();
  });
});
