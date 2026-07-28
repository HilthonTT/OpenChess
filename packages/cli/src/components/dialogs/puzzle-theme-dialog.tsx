import { useCallback, useMemo } from "react";
import { useDialog } from "../../providers/dialog";
import { DialogSearchList } from "../dialog-search-list";
import type { PuzzleThemeEntry } from "../../lib/puzzles";

/**
 * The theme picker: what to train next.
 *
 * The list leads with everything the corpus actually has, since a theme with no
 * puzzles behind it is a filter that can only disappoint — but the ones with a
 * zero are kept at the bottom rather than hidden, because "no forks imported
 * yet" is a more useful answer than a list that quietly omits forks.
 *
 * Each row carries the player's own record at the theme, which is the whole
 * reason to have this screen rather than a flat list of tags: the interesting
 * question is not "what themes exist" but "which am I bad at".
 */

/** The row that clears the filter, kept in the same list so `enter` picks it. */
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
      // Anything with puzzles behind it first, then by how much of it is left
      // unseen — which puts the themes worth opening this dialog for on top.
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

/** The right-hand column: how many there are, and how you have done at them. */
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
