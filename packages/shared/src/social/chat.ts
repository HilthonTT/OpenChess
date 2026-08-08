/**
 * The things you are allowed to say in a game.
 *
 * Online chess between strangers has exactly one chat problem, and it is not
 * that people cannot type. Free text would need moderation, reporting, muting,
 * a block list and a way to answer the abuse report that eventually arrives —
 * a whole subsystem, bolted to a terminal chess client, to deliver a message
 * that in practice is one of about nine sentences.
 *
 * So the wire carries a *key* and never a string. A player picks `goodGame`,
 * the row stores `goodGame`, and the opponent's client renders whatever this
 * catalog says that means. Nothing a player controls ever reaches another
 * player's screen, which is what makes the feature safe by construction rather
 * than safe by filtering. It also means the copy can be reworded — or
 * translated — without rewriting anyone's finished games.
 *
 * This is the one place the server and the CLI agree on the catalog, the same
 * way `time-control.ts` is the one place they agree on what a clock is. The
 * API validates against `CHAT_PHRASE_IDS`, so adding a phrase here is the whole
 * change: no migration, and no route that refuses a phrase the client offers.
 */

export type ChatPhraseId =
  | "hello"
  | "goodLuck"
  | "haveFun"
  | "niceMove"
  | "oops"
  | "sorry"
  | "thanks"
  | "goodGame"
  | "wellPlayed";

/**
 * When a phrase is worth offering first.
 *
 * Not a restriction — every phrase can be sent at any point, and a server that
 * policed the timing would be refusing "sorry" to the player who just hung a
 * queen. It is only ordering: the picker leads with `end` phrases once the game
 * is settled, because "good game" is what a player is reaching for then, and
 * with `start` phrases on move one.
 */
export type ChatPhraseMoment = "start" | "any" | "end";

export type ChatPhrase = {
  id: ChatPhraseId;
  /** What the opponent actually sees. */
  text: string;
  moment: ChatPhraseMoment;
};

export const CHAT_PHRASES: Record<ChatPhraseId, ChatPhrase> = {
  hello: { id: "hello", text: "Hello!", moment: "start" },
  goodLuck: { id: "goodLuck", text: "Good luck!", moment: "start" },
  haveFun: { id: "haveFun", text: "Have fun!", moment: "start" },
  niceMove: { id: "niceMove", text: "Nice move", moment: "any" },
  oops: { id: "oops", text: "Oops", moment: "any" },
  sorry: { id: "sorry", text: "Sorry", moment: "any" },
  thanks: { id: "thanks", text: "Thanks", moment: "any" },
  goodGame: { id: "goodGame", text: "Good game", moment: "end" },
  wellPlayed: { id: "wellPlayed", text: "Well played", moment: "end" },
};

/**
 * The catalog in the order it is offered, which is also the order the digit
 * keys select from. Kept to nine so `1`–`9` covers it exactly: a tenth phrase
 * would need a second row of keys, and the point of a canned list is that it
 * fits on one.
 */
export const CHAT_PHRASE_IDS: ChatPhraseId[] = [
  "hello",
  "goodLuck",
  "haveFun",
  "niceMove",
  "oops",
  "sorry",
  "thanks",
  "goodGame",
  "wellPlayed",
];

export const CHAT_PHRASE_LIST: ChatPhrase[] = CHAT_PHRASE_IDS.map(
  (id) => CHAT_PHRASES[id],
);

/** Whether `value` names a phrase in the catalog. The API's guard at the door. */
export function isChatPhraseId(value: string): value is ChatPhraseId {
  return Object.hasOwn(CHAT_PHRASES, value);
}

/**
 * The text for a stored key.
 *
 * Falls back to the key itself rather than throwing: a message written when the
 * catalog carried a phrase that has since been retired is still a message
 * somebody sent, and a finished game that cannot be rendered because of a copy
 * edit would be a much worse outcome than one line reading `goodGame`.
 */
export function chatPhraseText(id: string): string {
  return isChatPhraseId(id) ? CHAT_PHRASES[id].text : id;
}

/**
 * The catalog ordered for the moment the game is in: the phrases that fit come
 * first, the rest follow in catalog order. A stable partition rather than a
 * filter, so the same nine phrases are always on the same screen and only their
 * order moves — a picker whose contents change under you is worse than one
 * whose best answer is not always first.
 */
export function chatPhrasesFor(moment: ChatPhraseMoment): ChatPhrase[] {
  return [
    ...CHAT_PHRASE_LIST.filter((phrase) => phrase.moment === moment),
    ...CHAT_PHRASE_LIST.filter((phrase) => phrase.moment !== moment),
  ];
}
