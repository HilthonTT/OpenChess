import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".openchess");
const PREFERENCES_PATH = join(CONFIG_DIR, "preferences.json");

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
    return {};
  }
}

export function updatePreferences(patch: Partial<Preferences>): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(
      PREFERENCES_PATH,
      JSON.stringify({ ...readPreferences(), ...patch }, null, 2),
      { encoding: "utf-8" },
    );
  } catch {}
}
