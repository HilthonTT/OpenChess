import { useCallback, useEffect, useRef } from "react";
import { useDialog } from "../../providers/dialog";
import { usePieceSetContext } from "../../providers/pieces";
import {
  PIECE_SETS,
  PIECE_SET_DESCRIPTIONS,
  renderPiece,
  type PieceSet,
} from "../pieces";
import { DialogSearchList } from "../dialog-search-list";

/**
 * A back rank in each set, so the row shows the thing being chosen rather than
 * describing it. Which is the whole point of the dialog: someone opens it
 * *because* the figurines came out wrong, and a name alone would not tell them
 * whether the alternative renders any better in their terminal.
 */
const SAMPLE = ["R", "N", "B", "Q", "K", "P"] as const;

function sampleFor(set: PieceSet): string {
  return SAMPLE.map((piece) => renderPiece(piece, set)).join(" ");
}

export const PieceSetDialogContent = () => {
  const dialog = useDialog();
  const { pieceSet, setPieceSet, previewPieceSet } = usePieceSetContext();
  const originalRef = useRef<PieceSet>(pieceSet);
  const confirmedRef = useRef<boolean>(false);

  // Put the board back if the dialog is dismissed rather than confirmed.
  useEffect(() => {
    return () => {
      if (!confirmedRef.current) {
        previewPieceSet(originalRef.current);
      }
    };
  }, [previewPieceSet]);

  const handleSelect = useCallback(
    (set: PieceSet) => {
      confirmedRef.current = true;
      setPieceSet(set);
      dialog.close();
    },
    [setPieceSet, dialog],
  );

  const handleHighlight = useCallback(
    (set: PieceSet) => {
      previewPieceSet(set);
    },
    [previewPieceSet],
  );

  return (
    <DialogSearchList
      items={[...PIECE_SETS]}
      onSelect={handleSelect}
      onHighlight={handleHighlight}
      filterFn={(set, query) => set.includes(query.toLowerCase())}
      renderItem={(set, isSelected) => (
        <text selectable={false} fg={isSelected ? "black" : "white"}>
          {set === originalRef.current ? " • " : "   "}
          {`${set.padEnd(8)}${sampleFor(set)}   ${PIECE_SET_DESCRIPTIONS[set]}`}
        </text>
      )}
      getKey={(set) => set}
      placeholder="Search piece sets"
      emptyText="No matching piece sets"
    />
  );
};
