import { useCallback, useEffect, useRef } from "react";
import { useDialog } from "../../providers/dialog";
import { useTheme } from "../../providers/theme";
import { THEMES, type Theme } from "../../theme";
import { DialogSearchList } from "../dialog-search-list";

export const ThemeDialogContent = () => {
  const dialog = useDialog();
  const { setTheme, previewTheme, currentTheme } = useTheme();
  const originalThemeRef = useRef<Theme>(currentTheme);
  const confirmedRef = useRef<boolean>(false);

  // Revert to original theme if the user dismisses without confirming
  useEffect(() => {
    return () => {
      if (!confirmedRef.current) {
        previewTheme(originalThemeRef.current);
      }
    };
  }, [previewTheme]);

  const handleSelect = useCallback(
    (theme: Theme) => {
      confirmedRef.current = true;
      setTheme(theme);
      dialog.close();
    },
    [setTheme, dialog],
  );

  const handleHighlight = useCallback(
    (theme: Theme) => {
      previewTheme(theme);
    },
    [previewTheme],
  );

  return (
    <DialogSearchList
      items={THEMES}
      onSelect={handleSelect}
      onHighlight={handleHighlight}
      filterFn={(t, query) =>
        t.name.toLowerCase().includes(query.toLowerCase())
      }
      renderItem={(theme, isSelected) => (
        <text selectable={false} fg={isSelected ? "black" : "white"}>
          {theme.name === originalThemeRef.current.name
            ? "\u0020\u2022\u0020"
            : "\u0020\u0020\u0020"}
          {theme.name}
        </text>
      )}
      getKey={(t) => t.name}
      placeholder="Search themes"
      emptyText="No matching themes"
    />
  );
};
