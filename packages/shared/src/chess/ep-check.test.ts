import { describe, expect, it } from "bun:test";
import { parseFen } from "./board";

describe("parseFen en passant validation", () => {
  it("rejects an en passant square with no pawn to capture", () => {
    // Audit exploit: EP d6 but the pawn behind it is White's own knight.
    expect(() => parseFen("4k3/8/8/2PNP3/8/8/8/4K3 w - d6 0 1")).toThrow();
  });

  it("rejects an en passant square on the wrong rank", () => {
    expect(() =>
      parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e4 0 1"),
    ).toThrow();
  });

  it("accepts a legitimate en passant square", () => {
    const p = parseFen(
      "rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3",
    );
    expect(p.enPassant).not.toBeNull();
  });
});

import { repetitionKey } from "./board";

describe("repetitionKey en passant normalization", () => {
  it("ignores a phantom en passant square with no pawn to capture", () => {
    // Same placement, side, and castling; one has a phantom EP square, one
    // doesn't. FIDE treats these as the same position.
    const withPhantom = parseFen(
      "4k3/8/8/8/7P/8/8/4K3 b - h3 0 1",
    );
    const without = parseFen("4k3/8/8/8/7P/8/8/4K3 b - - 0 1");
    expect(repetitionKey(withPhantom)).toBe(repetitionKey(without));
  });

  it("keeps a capturable en passant square distinct", () => {
    // Black pawn on g4 can capture h3 en passant, so the square is real.
    const capturable = parseFen("4k3/8/8/8/6pP/8/8/4K3 b - h3 0 1");
    const without = parseFen("4k3/8/8/8/6pP/8/8/4K3 b - - 0 1");
    expect(repetitionKey(capturable)).not.toBe(repetitionKey(without));
  });
});
