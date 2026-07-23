import {
  chmodSync,
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
  /** Absent for sessions created before refresh support, or if Clerk omits it. */
  refreshToken?: string;
  /** Epoch ms when the access token expires; absent if Clerk gave no expires_in. */
  expiresAt?: number;
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
    cached =
      typeof parsed.token === "string"
        ? {
            token: parsed.token,
            refreshToken:
              typeof parsed.refreshToken === "string"
                ? parsed.refreshToken
                : undefined,
            expiresAt:
              typeof parsed.expiresAt === "number"
                ? parsed.expiresAt
                : undefined,
          }
        : null;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Re-read auth.json, bypassing the in-memory cache. Another CLI process is
 * also a legitimate writer — Clerk rotates the refresh token on every use, so
 * anything about to spend the grant must read the newest one off disk, not
 * this process's snapshot.
 */
export function reloadAuth(): AuthData | null {
  cached = undefined;
  return getAuth();
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
  // `mode` above only applies when the file is created — a file left behind by
  // an older build (or a restored backup) keeps whatever it had, so tighten it
  // on every save. Windows ignores POSIX modes; see the note above.
  try {
    chmodSync(AUTH_DIR, 0o700);
    chmodSync(AUTH_FILE, 0o600);
  } catch {
    // Best-effort: an exotic filesystem without chmod shouldn't break sign-in.
  }
  cached = { ...data };
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
