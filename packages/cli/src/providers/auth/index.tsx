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

export type AuthStatus = "checking" | "signed-out" | "signing-in" | "signed-in";

export type AuthContextValue = {
  status: AuthStatus;
  profile: AuthProfile | null;
  signIn: () => Promise<AuthProfile | null>;
  signOut: () => void;
  refresh: () => Promise<void>;
};

const UNAUTHORIZED = "unauthorized";

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

  useEffect(() => {
    return subscribeAuthCleared(() => {
      setProfile(null);
      setStatus("signed-out");
    });
  }, []);

  const signIn = useCallback(async () => {
    setStatus("signing-in");

    try {
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
