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
 * A `Content-Disposition` filename reduced to something safe to join onto a
 * directory, or null when nothing usable is left.
 *
 * The header is data off the network, not a name we chose: a hostile — or
 * merely MITM'd, since `API_URL` defaults to plain http — server answering with
 * `filename="../../.bashrc"` would otherwise have `join` walk straight out of
 * the export directory and `Bun.write` overwrite an arbitrary file with
 * arbitrary content. So the path structure is stripped rather than validated:
 * take the last segment on either separator, refuse the ones that still mean a
 * directory, and require the `.pgn` suffix this only ever writes.
 */
export function safeExportFilename(candidate: string): string | null {
  // Both separators, because the header is not the local platform's to spell:
  // `node:path` on POSIX does not treat a backslash as one, and a Windows
  // server's name would otherwise arrive as a single segment full of them.
  const base = candidate.split(/[/\\]/).pop()?.trim() ?? "";

  // "." and ".." survive the split above and both still name a directory;
  // control characters are unprintable in a file listing at best.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point — this is the filter that keeps them out
  const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

  if (
    base === "" ||
    base === "." ||
    base === ".." ||
    CONTROL_CHARS.test(base)
  ) {
    return null;
  }

  // Anything else claiming to be a PGN is not what this function writes.
  return base.toLowerCase().endsWith(".pgn") ? base : null;
}

/**
 * Download a finished game's PGN and write it next to the others.
 *
 * The filename comes from the server's `Content-Disposition` — it is the one
 * that names the date and the game — sanitized to a bare filename, with a local
 * fallback so neither a proxy that strips the header nor a server that sends a
 * hostile one decides where the file lands.
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
  const filename =
    (named ? safeExportFilename(named) : null) ??
    `openchess-${gameId.slice(-8)}.pgn`;

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
