import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parsePgn, splitPgnGames, type ParsedPgn } from "@openchess/shared";
import { apiClient } from "./api-client";
import { getProblemDetails, problemMessage } from "./http-errors";

export const DEFAULT_EXPORT_DIR = join(homedir(), "openchess");

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

export function safeExportFilename(candidate: string): string | null {
  const base = candidate.split(/[/\\]/).pop()?.trim() ?? "";

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

  return base.toLowerCase().endsWith(".pgn") ? base : null;
}

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
