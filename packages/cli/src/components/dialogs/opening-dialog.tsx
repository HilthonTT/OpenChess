import { useCallback, useMemo } from "react";
import { OPENING_LINES } from "@openchess/shared";
import type { OpeningLine } from "@openchess/shared";
import { useDialog } from "../../providers/dialog";
import { DialogSearchList } from "../dialog-search-list";

/**
 * Jump straight to a named opening instead of walking the tree down to it.
 *
 * The explorer can reach every line by hand, but "show me the Najdorf" is ten
 * keystrokes of tree-walking if you already know where you are going — and the
 * player who wants to look an opening up is exactly the player who does.
 */
export function OpeningDialogContent({
  onSelect,
}: {
  onSelect: (line: OpeningLine) => void;
}) {
  const dialog = useDialog();
  // `DialogSearchList` filters a mutable array; the book's is readonly.
  const items = useMemo(() => [...OPENING_LINES], []);

  const handleSelect = useCallback(
    (line: OpeningLine) => {
      onSelect(line);
      dialog.close();
    },
    [dialog, onSelect],
  );

  return (
    <DialogSearchList
      items={items}
      onSelect={handleSelect}
      // Matching the ECO code as well as the name lets "C50" find the Italian,
      // which is how anyone reading an annotated game arrives with the question.
      filterFn={(line, query) =>
        `${line.eco} ${line.name}`.toLowerCase().includes(query.toLowerCase())
      }
      renderItem={(line, isSelected) => (
        <text selectable={false} fg={isSelected ? "black" : "white"}>
          {` ${line.eco}  ${line.name}`}
        </text>
      )}
      getKey={(line) => `${line.eco}:${line.name}`}
      placeholder="Search openings by name or ECO"
      emptyText="No matching openings"
    />
  );
}
