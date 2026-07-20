import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { apiClient } from "../../lib/api-client";
import { clearAuth, getAuth, subscribeAuthCleared } from "../../lib/auth";
import { performLogin } from "../../lib/oauth";

export type AuthProfile = {
  username: string;
  level: number;
  coins: number;
};

export type AuthStatus =
  /** A token is on disk but the server hasn't vouched for it yet. */
  | "checking"
  | "signed-out"
  /** The browser is open and we're waiting for the OAuth callback. */
  | "signing-in"
  | "signed-in";

export type AuthContextValue = {
  status: AuthStatus;
  /** Null while checking/signing in, or when signed in but the server is unreachable. */
  profile: AuthProfile | null;
  /** Resolves with the profile once the browser flow completes; rejects if it fails. */
  signIn: () => Promise<AuthProfile | null>;
  signOut: () => void;
  /** Re-fetch the profile, e.g. after a game pays out XP and coins. */
  refresh: () => Promise<void>;
};

/** The token was rejected; `apiClient` has already wiped it from disk. */
const UNAUTHORIZED = "unauthorized";
/** The server didn't answer. The token may still be good, so keep it. */
const UNREACHABLE = "unreachable";

type ProfileResult = AuthProfile | typeof UNAUTHORIZED | typeof UNREACHABLE;

async function fetchProfile(): Promise<ProfileResult> {
  try {
    const response = await apiClient.me.$get();

    if (!response.ok) {
      return response.status === 401 ? UNAUTHORIZED : UNREACHABLE;
    }

    const profile = await response.json();
    return {
      username: profile.username,
      level: profile.level,
      coins: profile.coins,
    };
  } catch {
    // Server down, no network, or a body we couldn't parse.
    return UNREACHABLE;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

type Props = {
  children: ReactNode;
};

export function AuthProvider({ children }: Props) {
  const [status, setStatus] = useState<AuthStatus>(() =>
    getAuth() ? "checking" : "signed-out",
  );
  const [profile, setProfile] = useState<AuthProfile | null>(null);

  // Validate the stored token once at startup so the menu never claims we're
  // signed in with a token the server has since rejected. A server we can't
  // reach is not a rejection: we stay signed in, just without a profile.
  useEffect(() => {
    if (!getAuth()) {
      return;
    }

    let cancelled = false;
    void fetchProfile().then((result) => {
      if (cancelled) {
        return;
      }

      if (result === UNAUTHORIZED) {
        clearAuth();
        setProfile(null);
        setStatus("signed-out");
        return;
      }

      setProfile(result === UNREACHABLE ? null : result);
      setStatus("signed-in");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // `apiClient` wipes the token from disk on any 401; without this the header
  // would keep saying "Signed in" against a token that no longer exists.
  useEffect(() => {
    return subscribeAuthCleared(() => {
      setProfile(null);
      setStatus("signed-out");
    });
  }, []);

  const signIn = useCallback(async () => {
    setStatus("signing-in");

    try {
      // Opens the browser and resolves once Clerk redirects back to us.
      await performLogin();
    } catch (error) {
      clearAuth();
      setProfile(null);
      setStatus("signed-out");
      throw error;
    }

    const result = await fetchProfile();
    if (result === UNAUTHORIZED) {
      setProfile(null);
      setStatus("signed-out");
      throw new Error("The server rejected the new token");
    }

    const nextProfile = result === UNREACHABLE ? null : result;
    setProfile(nextProfile);
    setStatus("signed-in");
    return nextProfile;
  }, []);

  const signOut = useCallback(() => {
    clearAuth();
    setProfile(null);
    setStatus("signed-out");
  }, []);

  const refresh = useCallback(async () => {
    if (!getAuth()) {
      return;
    }

    const result = await fetchProfile();

    if (result === UNAUTHORIZED) {
      clearAuth();
      setProfile(null);
      setStatus("signed-out");
      return;
    }

    // An unreachable server keeps the profile we already have; stale numbers
    // beat a header that suddenly forgets who you are.
    if (result !== UNREACHABLE) {
      setProfile(result);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, profile, signIn, signOut, refresh }),
    [status, profile, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return value;
}
