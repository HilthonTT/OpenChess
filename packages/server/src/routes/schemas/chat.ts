import { z } from "@hono/zod-openapi";
import {
  CHAT_PHRASE_IDS,
  SPECTATOR_PHRASE_IDS,
  type ChatPhraseId,
} from "@openchess/shared";

export const chatPhraseSchema = z
  .enum(CHAT_PHRASE_IDS as [ChatPhraseId, ...ChatPhraseId[]])
  .openapi({ example: "goodGame" });

export const spectatorPhraseSchema = z
  .enum(SPECTATOR_PHRASE_IDS as [ChatPhraseId, ...ChatPhraseId[]])
  .openapi({ example: "brilliant" });

export const chatMessageSchema = z
  .object({
    id: z.string(),
    phrase: z.string().openapi({ example: "goodGame" }),
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
