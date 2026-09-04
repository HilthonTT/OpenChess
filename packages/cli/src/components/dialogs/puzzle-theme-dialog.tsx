import { useCallback, useMemo } from "react";
import { useDialog } from "../../providers/dialog";
import { DialogSearchList } from "../dialog-search-list";
import type { PuzzleThemeEntry } from "../../lib/puzzles";

const ANY: PuzzleThemeEntry = {
  key: "",
  label: "Any theme",
  group: "",
  trainable: true,
  available: 0,
  attempted: 0,
  solved: 0,
};

export function PuzzleThemeDialogContent({
  themes,
  onSelect,
}: {
  themes: PuzzleThemeEntry[];
  onSelect: (theme: string | null) => void;
}) {
  const dialog = useDialog();

  const items = useMemo(() => {
    const trainable = themes.filter((entry) => entry.trainable);

    const ranked = [...trainable].sort((a, b) => {
      const hasA = a.available > 0 ? 1 : 0;
      const hasB = b.available > 0 ? 1 : 0;
      if (hasA !== hasB) {
        return hasB - hasA;
      }
      return b.available - a.available || a.label.localeCompare(b.label);
    });

    return [ANY, ...ranked];
  }, [themes]);

  const handleSelect = useCallback(
    (entry: PuzzleThemeEntry) => {
      onSelect(entry.key === "" ? null : entry.key);
      dialog.close();
    },
    [dialog, onSelect],
  );

  return (
    <DialogSearchList
      items={items}
      onSelect={handleSelect}
      filterFn={(entry, query) =>
        `${entry.label} ${entry.key}`
          .toLowerCase()
          .includes(query.toLowerCase())
      }
      renderItem={(entry, isSelected) => (
        <text selectable={false} fg={isSelected ? "black" : "white"}>
          {` ${entry.label.padEnd(24)}${describe(entry)}`}
        </text>
      )}
      getKey={(entry) => entry.key || "any"}
      placeholder="Search themes"
      emptyText="No matching themes"
    />
  );
}

function describe(entry: PuzzleThemeEntry): string {
  if (entry.key === "") {
    return "the whole catalog";
  }

  if (entry.available === 0) {
    return "none imported";
  }

  if (entry.attempted === 0) {
    return `${entry.available} puzzles · untried`;
  }

  const percent = Math.round((entry.solved / entry.attempted) * 100);
  return `${entry.available} puzzles · ${entry.solved}/${entry.attempted} solved (${percent}%)`;
}
