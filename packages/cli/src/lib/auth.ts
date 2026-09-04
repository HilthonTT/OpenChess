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
  refreshToken?: string;
  expiresAt?: number;
};

const AUTH_DIR = join(homedir(), ".openchess");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

let cached: AuthData | null | undefined;

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

export function reloadAuth(): AuthData | null {
  cached = undefined;
  return getAuth();
}

export function saveAuth(data: AuthData) {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { mode: 0o700 });
  }
  writeFileSync(AUTH_FILE, JSON.stringify(data), { mode: 0o600 });
  try {
    chmodSync(AUTH_DIR, 0o700);
    chmodSync(AUTH_FILE, 0o600);
  } catch {}
  cached = { ...data };
}

export function clearAuth() {
  const hadAuth = getAuth() !== null;
  cached = null;

  try {
    unlinkSync(AUTH_FILE);
  } catch {}

  if (hadAuth) {
    for (const listener of clearedListeners) {
      listener();
    }
  }
}
