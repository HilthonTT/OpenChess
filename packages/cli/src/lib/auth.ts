import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type AuthData = {
  token: string;
};

const AUTH_DIR = join(homedir(), ".openchess");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

export function getAuth(): AuthData | null {
  try {
    const data = readFileSync(AUTH_FILE, "utf-8");
    const parsed = JSON.parse(data) as Partial<AuthData>;
    return typeof parsed.token === "string" ? { token: parsed.token } : null;
  } catch {
    return null;
  }
}

export function saveAuth(data: AuthData) {
  if (!existsSync(AUTH_DIR)) {
    // Owner-only permissions (rwx------) so other users on the machine can't read tokens
    mkdirSync(AUTH_DIR, { mode: 0o700 });
  }
  // The token is stored in plaintext. The mode narrows access on Unix, but
  // Windows ignores POSIX modes entirely — there the file inherits the home
  // directory's ACL, which for a normal single-user setup is still owner-only.
  writeFileSync(AUTH_FILE, JSON.stringify(data), { mode: 0o600 });
}

export function clearAuth() {
  try {
    unlinkSync(AUTH_FILE);
  } catch (error) {
    // File doesn't exist
  }
}
