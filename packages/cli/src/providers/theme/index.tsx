import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { BoardTheme, ThemeColors, Theme, UITheme } from "../../theme";
import { DEFAULT_THEME, THEMES, toBoardTheme, toUITheme } from "../../theme";

const CONFIG_DIR = join(homedir(), ".openchess");
const THEME_PREFERENCES_PATH = join(CONFIG_DIR, "preferences.json");

type ThemePreferences = {
  themeName: string;
};

function getInitialTheme(): Theme {
  try {
    const preferences = JSON.parse(
      readFileSync(THEME_PREFERENCES_PATH, { encoding: "utf-8" }),
    ) as Partial<ThemePreferences>;

    const savedTheme = THEMES.find(
      (theme) => theme.name === preferences.themeName,
    );

    return savedTheme ?? DEFAULT_THEME;
  } catch {
    // Missing or unreadable preferences file - fall back to the default.
    return DEFAULT_THEME;
  }
}

function persistTheme(theme: Theme): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(
      THEME_PREFERENCES_PATH,
      JSON.stringify(
        { themeName: theme.name } satisfies ThemePreferences,
        null,
        2,
      ),
      { encoding: "utf-8" },
    );
  } catch {
    // Ignore preference write failures so theme switching still works for this session.
  }
}

type ThemeContextValue = {
  colors: ThemeColors;
  currentTheme: Theme;
  setTheme: (theme: Theme) => void;
  /** Apply a theme for this session only, without persisting it to disk. */
  previewTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return value;
}

export function useUITheme(): UITheme {
  const { colors } = useTheme();
  return useMemo(() => toUITheme(colors), [colors]);
}

export function useBoardTheme(): BoardTheme {
  const { colors } = useTheme();
  return useMemo(() => toBoardTheme(colors), [colors]);
}

type ThemeProviderProps = {
  children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [currentTheme, setCurrentTheme] = useState<Theme>(getInitialTheme);

  const setTheme = useCallback((theme: Theme) => {
    setCurrentTheme(theme);
    persistTheme(theme);
  }, []);

  const previewTheme = useCallback((theme: Theme) => {
    setCurrentTheme(theme);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ colors: currentTheme.colors, currentTheme, setTheme, previewTheme }),
    [currentTheme, setTheme, previewTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
