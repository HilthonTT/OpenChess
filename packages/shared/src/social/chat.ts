export type ChatPhraseId =
  | "hello"
  | "goodLuck"
  | "haveFun"
  | "niceMove"
  | "oops"
  | "sorry"
  | "thanks"
  | "goodGame"
  | "wellPlayed"
  | "goodLuckBoth"
  | "whatAGame"
  | "closeOne"
  | "brilliant"
  | "ouch"
  | "didntSeeThat";

export type ChatPhraseMoment = "start" | "any" | "end";

export type ChatPhrase = {
  id: ChatPhraseId;
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

  goodLuckBoth: {
    id: "goodLuckBoth",
    text: "Good luck, both",
    moment: "start",
  },
  whatAGame: { id: "whatAGame", text: "What a game", moment: "any" },
  closeOne: { id: "closeOne", text: "This is close", moment: "any" },
  brilliant: { id: "brilliant", text: "Brilliant", moment: "any" },
  ouch: { id: "ouch", text: "Ouch", moment: "any" },
  didntSeeThat: {
    id: "didntSeeThat",
    text: "Didn't see that",
    moment: "any",
  },
};

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

export const SPECTATOR_PHRASE_IDS: ChatPhraseId[] = [
  "hello",
  "goodLuckBoth",
  "niceMove",
  "brilliant",
  "closeOne",
  "didntSeeThat",
  "ouch",
  "whatAGame",
  "wellPlayed",
];

export const SPECTATOR_PHRASE_LIST: ChatPhrase[] = SPECTATOR_PHRASE_IDS.map(
  (id) => CHAT_PHRASES[id],
);

export function isChatPhraseId(value: string): value is ChatPhraseId {
  return Object.hasOwn(CHAT_PHRASES, value);
}

export function isPlayerPhraseId(value: string): value is ChatPhraseId {
  return (CHAT_PHRASE_IDS as string[]).includes(value);
}

export function isSpectatorPhraseId(value: string): value is ChatPhraseId {
  return (SPECTATOR_PHRASE_IDS as string[]).includes(value);
}

export function chatPhraseText(id: string): string {
  return isChatPhraseId(id) ? CHAT_PHRASES[id].text : id;
}

export function chatPhrasesFor(
  moment: ChatPhraseMoment,
  list: ChatPhrase[] = CHAT_PHRASE_LIST,
): ChatPhrase[] {
  return [
    ...list.filter((phrase) => phrase.moment === moment),
    ...list.filter((phrase) => phrase.moment !== moment),
  ];
}
