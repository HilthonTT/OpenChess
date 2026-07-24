import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parsePgn, splitPgnGames, type ParsedPgn } from "@openchess/shared";
import { apiClient } from "./api-client";
import { getProblemDetails, problemMessage } from "./http-errors";

/**
 * Getting games in and out of the terminal as PGN.
 *
 * Export is a download from the server, which holds the archival text written
 * when the game settled; import is a local file, parsed here so the Analysis
 * screen can review a game that was never played on this server at all.
 */

/** Where exports land when the user does not say otherwise. */
export const DEFAULT_EXPORT_DIR = join(homedir(), "openchess");

/** `~/games.pgn` and `~\games.pgn` both mean the same thing to a person. */
export function expandPath(input: string): string {
  const trimmed = input.trim().replace(/^["']|["']$/g, "");

  if (trimmed === "~") {
    return homedir();
  }

  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2));
  }

  return resolve(trimmed);
}

/**
 * Download a finished game's PGN and write it next to the others.
 *
 * The filename comes from the server's `Content-Disposition` — it is the one
 * that names the date and the game — with a local fallback so a proxy that
 * strips the header cannot leave the file nameless.
 */
export async function exportGamePgn(
  gameId: string,
  directory: string = DEFAULT_EXPORT_DIR,
): Promise<{ path: string; pgn: string }> {
  const response = await apiClient.games[":id"].pgn.$get({
    param: { id: gameId },
  });

  if (response.status !== 200) {
    throw new Error(problemMessage(await getProblemDetails(response)));
  }

  const pgn = await response.text();

  const disposition = response.headers.get("content-disposition") ?? "";
  const named = /filename="([^"]+)"/.exec(disposition)?.[1];
  const filename = named ?? `openchess-${gameId.slice(-8)}.pgn`;

  const path = join(directory, filename);

  await Bun.write(path, pgn);

  return { path, pgn };
}

/**
 * Read a PGN file and parse the first game in it.
 *
 * Only the first: the review screen shows one game, and quietly reviewing game
 * seven of a collection because it happened to be last would be worse than
 * saying how many were found. The count comes back so the caller can.
 */
export async function importPgnFile(
  path: string,
): Promise<{ game: ParsedPgn; total: number }> {
  const file = Bun.file(expandPath(path));

  if (!(await file.exists())) {
    throw new Error(`No such file: ${path}`);
  }

  const text = await file.text();
  const games = splitPgnGames(text);

  if (games.length === 0) {
    throw new Error("That file has no games in it");
  }

  return { game: parsePgn(games[0]!), total: games.length };
}
