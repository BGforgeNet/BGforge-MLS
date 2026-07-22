import type { Facing } from "@bgforge/image";
import type { AnimationView, SequenceView } from "../messages";

/** A cell in the 3x3 compass rose; (1,1) is the unused center. */
export interface Cell {
    row: 0 | 1 | 2;
    col: 0 | 1 | 2;
}

// "none" is not a compass facing - the grid fallback handles non-directional animations.
const COMPASS_CELLS: Record<Facing, Cell | undefined> = {
    NW: { row: 0, col: 0 },
    N: { row: 0, col: 1 },
    NE: { row: 0, col: 2 },
    W: { row: 1, col: 0 },
    E: { row: 1, col: 2 },
    SW: { row: 2, col: 0 },
    S: { row: 2, col: 1 },
    SE: { row: 2, col: 2 },
    none: undefined,
};

export function compassCell(facing: Facing): Cell | undefined {
    return COMPASS_CELLS[facing];
}

type CompassLayout = { mode: "compass"; tiles: { seq: SequenceView; cell: Cell }[] };
type GridLayout = { mode: "grid"; tiles: { seq: SequenceView; index: number }[] };

/**
 * Compass rose when every sequence maps to a unique compass facing (FRM's 6, or an 8-facing BAM);
 * grid fallback otherwise (non-directional, or duplicate facings, which cannot share one cell).
 */
export function layoutSequences(view: AnimationView): CompassLayout | GridLayout {
    const facings = view.sequences.map((seq) => seq.facing);
    const allCompass = facings.every((facing) => compassCell(facing) !== undefined);
    const allUnique = new Set(facings).size === facings.length;

    if (allCompass && allUnique) {
        const tiles = view.sequences.flatMap((seq) => {
            const cell = compassCell(seq.facing);
            return cell === undefined ? [] : [{ seq, cell }];
        });
        return { mode: "compass", tiles };
    }

    return { mode: "grid", tiles: view.sequences.map((seq, index) => ({ seq, index })) };
}
