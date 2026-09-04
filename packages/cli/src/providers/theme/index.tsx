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
  updatePreferences({ themeName: theme.name });
}

type ThemeContextValue = {
  colors: ThemeColors;
  currentTheme: Theme;
  setTheme: (theme: Theme) => void;
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
