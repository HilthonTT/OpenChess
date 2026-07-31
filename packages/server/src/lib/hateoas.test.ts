import { describe, expect, test } from "bun:test";

import {
  gameLinks,
  offsetPageLinks,
  pageLinks,
  withFriendLinks,
  withPlayerLinks,
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
    drawOfferFrom: null as "w" | "b" | null,
  };
}

/** The same, as an online game — where the draw links live. */
function freshPvpGame() {
  return { ...freshGame(), mode: "PVP" as const };
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

  test("a live PvP game with no offer on it can only offer one", () => {
    const links = gameLinks(freshPvpGame());

    expect(links.offerDraw).toEqual({
      href: "/api/games/game1/draw",
      method: "POST",
    });
    expect(links.acceptDraw).toBeUndefined();
    expect(links.declineDraw).toBeUndefined();
  });

  test("your own standing offer can be withdrawn but not re-offered", () => {
    const links = gameLinks({ ...freshPvpGame(), drawOfferFrom: "w" });

    expect(links.offerDraw).toBeUndefined();
    expect(links.acceptDraw).toBeUndefined();
    expect(links.declineDraw).toEqual({
      href: "/api/games/game1/draw",
      method: "DELETE",
    });
  });

  test("the opponent's offer can be accepted or declined", () => {
    const links = gameLinks({ ...freshPvpGame(), drawOfferFrom: "b" });

    expect(links.acceptDraw).toEqual({
      href: "/api/games/game1/draw/accept",
      method: "POST",
    });
    expect(links.declineDraw).toEqual({
      href: "/api/games/game1/draw",
      method: "DELETE",
    });
    // Still offerable: offering into their offer is how agreement is reached.
    expect(links.offerDraw).toBeDefined();
  });

  test("an AI game offers no draw links at all", () => {
    const links = gameLinks(freshGame());

    expect(links.offerDraw).toBeUndefined();
    expect(links.acceptDraw).toBeUndefined();
    expect(links.declineDraw).toBeUndefined();
  });

  test("a settled PvP game offers no draw links", () => {
    const links = gameLinks({
      ...freshPvpGame(),
      result: "DRAW",
      drawOfferFrom: "b",
    });

    expect(links.offerDraw).toBeUndefined();
    expect(links.acceptDraw).toBeUndefined();
    expect(links.declineDraw).toBeUndefined();
    expect(links.moves).toBeUndefined();
    expect(links.resign).toBeUndefined();
  });
});

describe("the chat link", () => {
  test("is offered in a live PvP game", () => {
    expect(gameLinks(freshPvpGame()).say).toEqual({
      href: "/api/games/game1/chat",
      method: "POST",
    });
  });

  // The one link that outlives the result. "Good game" is said after the game,
  // and a link that vanished on the final move would take it away exactly then.
  test("survives the game it belongs to", () => {
    const links = gameLinks({ ...freshPvpGame(), result: "WHITE_WIN" });

    expect(links.say).toBeDefined();
  });

  test("is absent against the bot, which has nobody to tell", () => {
    expect(gameLinks(freshGame()).say).toBeUndefined();
  });
});

describe("withFriendLinks", () => {
  const row = { id: "f1", username: "magnus", status: "PENDING", outgoing: false };

  test("a request addressed to you can be accepted or declined", () => {
    const links = withFriendLinks(row)._links;

    expect(links.accept).toEqual({
      href: "/api/friends/f1/accept",
      method: "POST",
    });
    expect(links.decline).toBeDefined();
    // Declining is the answer to somebody else's question; withdrawing is not
    // yours to do.
    expect(links.remove).toBeUndefined();
  });

  test("a request you sent can only be withdrawn", () => {
    const links = withFriendLinks({ ...row, outgoing: true })._links;

    expect(links.accept).toBeUndefined();
    expect(links.decline).toBeUndefined();
    expect(links.remove).toEqual({ href: "/api/friends/f1", method: "DELETE" });
  });

  test("a friendship can be played and ended, and not answered", () => {
    const links = withFriendLinks({ ...row, status: "ACCEPTED" })._links;

    expect(links.challenge).toEqual({
      href: "/api/challenges",
      method: "POST",
    });
    expect(links.remove).toBeDefined();
    expect(links.accept).toBeUndefined();
  });

  test("always points at the player behind the row", () => {
    expect(withFriendLinks(row)._links.profile).toEqual({
      href: "/api/players/magnus",
      method: "GET",
    });
  });
});

describe("withPlayerLinks", () => {
  const profileFor = (state: string, friendshipId: string | null = null) =>
    withPlayerLinks({ username: "magnus", friendship: { state, friendshipId } })
      ._links;

  test("a stranger can be asked and challenged", () => {
    const links = profileFor("none");

    expect(links.addFriend).toEqual({ href: "/api/friends", method: "POST" });
    expect(links.challenge).toBeDefined();
    expect(links.removeFriend).toBeUndefined();
  });

  test("their standing request is yours to answer", () => {
    const links = profileFor("requestReceived", "f1");

    expect(links.acceptFriend).toEqual({
      href: "/api/friends/f1/accept",
      method: "POST",
    });
    expect(links.declineFriend).toBeDefined();
    expect(links.addFriend).toBeUndefined();
  });

  test("your own standing request is yours to withdraw", () => {
    const links = profileFor("requestSent", "f1");

    expect(links.removeFriend).toEqual({
      href: "/api/friends/f1",
      method: "DELETE",
    });
    expect(links.addFriend).toBeUndefined();
    expect(links.acceptFriend).toBeUndefined();
  });

  test("your own profile offers nothing to do to yourself", () => {
    const links = profileFor("self");

    expect(links.addFriend).toBeUndefined();
    expect(links.challenge).toBeUndefined();
    expect(links.self).toEqual({
      href: "/api/players/magnus",
      method: "GET",
    });
  });

  // The state says there is a friendship but the id is missing — a row that
  // cannot be addressed must not produce a link to nowhere.
  test("omits the friendship links when there is no row to address", () => {
    const links = profileFor("friends", null);

    expect(links.removeFriend).toBeUndefined();
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
