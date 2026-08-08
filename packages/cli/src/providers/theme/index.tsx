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
import { readPreferences, updatePreferences } from "../../lib/preferences";

function getInitialTheme(): Theme {
  const savedName = readPreferences().themeName;
  return THEMES.find((theme) => theme.name === savedName) ?? DEFAULT_THEME;
}

function persistTheme(theme: Theme): void {
  // Through `updatePreferences` rather than a write of its own: the piece set
  // lives in the same file, and writing only `themeName` would erase it.
  updatePreferences({ themeName: theme.name });
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
  /**
   * A theme to start on instead of the saved one — what `--theme` passes in.
   * It is only the starting point: nothing here writes it to disk, so a theme
   * asked for on the command line lasts exactly as long as the session does.
   */
  initialTheme?: Theme;
};

export function ThemeProvider({ children, initialTheme }: ThemeProviderProps) {
  const [currentTheme, setCurrentTheme] = useState<Theme>(
    () => initialTheme ?? getInitialTheme(),
  );

  const setTheme = useCallback((theme: Theme) => {
    setCurrentTheme(theme);
    persistTheme(theme);
  }, []);

  const previewTheme = useCallback((theme: Theme) => {
    setCurrentTheme(theme);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: currentTheme.colors,
      currentTheme,
      setTheme,
      previewTheme,
    }),
    [currentTheme, setTheme, previewTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
