import { useCallback, useMemo } from "react";
import { OPENING_LINES } from "@openchess/shared";
import type { OpeningLine } from "@openchess/shared";
import { useDialog } from "../../providers/dialog";
import { DialogSearchList } from "../dialog-search-list";

export function OpeningDialogContent({
  onSelect,
}: {
  onSelect: (line: OpeningLine) => void;
}) {
  const dialog = useDialog();
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
