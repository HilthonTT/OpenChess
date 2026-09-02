import { z } from "@hono/zod-openapi";
import {
  CHAT_PHRASE_IDS,
  SPECTATOR_PHRASE_IDS,
  type ChatPhraseId,
} from "@openchess/shared";

/**
 * A phrase key a *player* may send — never free text. Enumerated from
 * @openchess/shared's catalog rather than written out here, so adding a phrase
 * cannot leave the API refusing one the client offers.
 */
export const chatPhraseSchema = z
  .enum(CHAT_PHRASE_IDS as [ChatPhraseId, ...ChatPhraseId[]])
  .openapi({ example: "goodGame" });

/**
 * And one a *watcher* may send. A different list, because a spectator is in a
 * different conversation: half the players' catalog is about the speaker's own
 * move and reads as somebody else's when a watcher sends it.
 */
export const spectatorPhraseSchema = z
  .enum(SPECTATOR_PHRASE_IDS as [ChatPhraseId, ...ChatPhraseId[]])
  .openapi({ example: "brilliant" });

/**
 * A message in either conversation. One shape for both — a phrase key from the
 * catalog, who said it, and when — because which channel it arrived on is a
 * fact about the request that fetched it, not about the message.
 */
export const chatMessageSchema = z
  .object({
    id: z.string(),
    /** The catalog key. The client renders it; the server never sends text. */
    phrase: z.string().openapi({ example: "goodGame" }),
    /** True when you are the one who said it. */
    mine: z.boolean(),
    username: z.string(),
    createdAt: z.string(),
  })
  .openapi("ChatMessage");

export const sendChatSchema = z
  .object({ phrase: chatPhraseSchema })
  .openapi("SendChatMessage");

export const sendSpectatorChatSchema = z
  .object({ phrase: spectatorPhraseSchema })
  .openapi("SendSpectatorChatMessage");
