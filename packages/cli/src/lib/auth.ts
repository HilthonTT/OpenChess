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

// In-memory copy of what's on disk, so the api-client doesn't hit the
// filesystem on every request (including the 2-second game polls). Invalidated
// by saveAuth/clearAuth, which are the only writers of AUTH_FILE.
let cached: AuthData | null | undefined;

// Notified when the token is wiped (401, sign-out), so the UI can flip to
// signed-out without polling the disk.
const clearedListeners = new Set<() => void>();

export function subscribeAuthCleared(listener: () => void): () => void {
  clearedListeners.add(listener);
  return () => {
    clearedListeners.delete(listener);
  };
}

export function getAuth(): AuthData | null {
  if (cached !== undefined) {
    return cached;
  }

  try {
    const data = readFileSync(AUTH_FILE, "utf-8");
    const parsed = JSON.parse(data) as Partial<AuthData>;
    cached = typeof parsed.token === "string" ? { token: parsed.token } : null;
  } catch {
    cached = null;
  }
  return cached;
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
  cached = { token: data.token };
}

export function clearAuth() {
  // Idempotent: a second clear (e.g. signOut after a 401 already wiped the
  // token) must not re-notify listeners.
  const hadAuth = getAuth() !== null;
  cached = null;

  try {
    unlinkSync(AUTH_FILE);
  } catch (error) {
    // File doesn't exist
  }

  if (hadAuth) {
    for (const listener of clearedListeners) {
      listener();
    }
  }
}
