import { describe, expect, test } from "bun:test";

import { safeExportFilename } from "./pgn-files";

describe("safeExportFilename", () => {
  test("keeps the name the server is supposed to send", () => {
    expect(safeExportFilename("openchess-2026-07-29-abc123-42ply.pgn")).toBe(
      "openchess-2026-07-29-abc123-42ply.pgn",
    );
  });

  test("strips a leading path rather than trusting it", () => {
    expect(safeExportFilename("/etc/cron.d/game.pgn")).toBe("game.pgn");
    expect(safeExportFilename("sub/dir/game.pgn")).toBe("game.pgn");
  });

  test("refuses to walk out of the export directory", () => {
    expect(safeExportFilename("../../.bashrc")).toBeNull();
    expect(safeExportFilename("../../../etc/passwd")).toBeNull();
    expect(safeExportFilename("..")).toBeNull();
    expect(safeExportFilename(".")).toBeNull();
  });

  test("treats a backslash as a separator too, whatever the platform thinks", () => {
    expect(safeExportFilename("..\\..\\.bashrc")).toBeNull();
    expect(safeExportFilename("C:\\Windows\\evil.pgn")).toBe("evil.pgn");
  });

  test("rejects anything that is not a .pgn", () => {
    expect(safeExportFilename("authorized_keys")).toBeNull();
    expect(safeExportFilename(".bashrc")).toBeNull();
    expect(safeExportFilename("")).toBeNull();
  });

  test("rejects control characters and an empty segment", () => {
    expect(safeExportFilename("game\n.pgn")).toBeNull();
    expect(safeExportFilename("game\u0000.pgn")).toBeNull();
    expect(safeExportFilename("dir/")).toBeNull();
  });

  test("is case-insensitive about the suffix", () => {
    expect(safeExportFilename("GAME.PGN")).toBe("GAME.PGN");
  });
});
