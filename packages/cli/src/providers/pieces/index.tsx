import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_PIECE_SET,
  isPieceSet,
  type PieceSet,
} from "../../components/pieces";
import { readPreferences, updatePreferences } from "../../lib/preferences";

function getInitialPieceSet(): PieceSet {
  const saved = readPreferences().pieceSet;
  return saved !== undefined && isPieceSet(saved) ? saved : DEFAULT_PIECE_SET;
}

type PieceSetContextValue = {
  pieceSet: PieceSet;
  setPieceSet: (set: PieceSet) => void;
  previewPieceSet: (set: PieceSet) => void;
};

const PieceSetContext = createContext<PieceSetContextValue | null>(null);

export function usePieceSetContext(): PieceSetContextValue {
  const value = useContext(PieceSetContext);
  if (!value) {
    throw new Error(
      "usePieceSetContext must be used within a PieceSetProvider",
    );
  }
  return value;
}

export function usePieceSet(): PieceSet {
  return usePieceSetContext().pieceSet;
}

type PieceSetProviderProps = {
  children: ReactNode;
  initialPieceSet?: PieceSet;
};

export function PieceSetProvider({
  children,
  initialPieceSet,
}: PieceSetProviderProps) {
  const [pieceSet, setCurrentPieceSet] = useState<PieceSet>(
    () => initialPieceSet ?? getInitialPieceSet(),
  );

  const setPieceSet = useCallback((set: PieceSet) => {
    setCurrentPieceSet(set);
    updatePreferences({ pieceSet: set });
  }, []);

  const previewPieceSet = useCallback((set: PieceSet) => {
    setCurrentPieceSet(set);
  }, []);

  const value = useMemo<PieceSetContextValue>(
    () => ({ pieceSet, setPieceSet, previewPieceSet }),
    [pieceSet, setPieceSet, previewPieceSet],
  );

  return (
    <PieceSetContext.Provider value={value}>
      {children}
    </PieceSetContext.Provider>
  );
}
