import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".openchess");
const PREFERENCES_PATH = join(CONFIG_DIR, "preferences.json");

/** What the app remembers between sessions. Every field is optional on disk. */
export type Preferences = {
  themeName: string;
  pieceSet: string;
};

export function readPreferences(): Partial<Preferences> {
  try {
    return JSON.parse(
      readFileSync(PREFERENCES_PATH, { encoding: "utf-8" }),
    ) as Partial<Preferences>;
  } catch {
    // Missing, unreadable or not JSON — the caller falls back to its default.
    return {};
  }
}

/**
 * Merge `patch` into the saved preferences.
 *
 * Read-modify-write rather than a plain overwrite. The theme and the piece set
 * are picked from different dialogs and share one file, so a writer that
 * serialized only its own field would silently drop the other every time it
 * ran — change the theme, lose the piece set.
 */
export function updatePreferences(patch: Partial<Preferences>): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(
      PREFERENCES_PATH,
      JSON.stringify({ ...readPreferences(), ...patch }, null, 2),
      { encoding: "utf-8" },
    );
  } catch {
    // Ignore write failures so switching still works for this session.
  }
}
