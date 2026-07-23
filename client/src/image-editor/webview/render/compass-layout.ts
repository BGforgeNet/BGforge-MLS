import type { Facing } from "@bgforge/image";
import type { AnimationView, SequenceView } from "../messages";

/**
 * A tile's position on the compass rose as a unit-circle offset from the centre (y points DOWN, to
 * match screen coordinates). The caller scales dx/dy by a pixel radius. A rigid grid was tried first
 * and rejected: with FRM's 6 facings (no N/S) the middle column is empty, so the rose collapsed into
 * two straight columns. Placing each facing at its true compass angle keeps E/W out at the sides and
 * the diagonals pulled in, so 6 facings read as a hexagon and 8 as an octagon - an actual rose.
 */
export interface RosePosition {
    dx: number;
    dy: number;
}

// Compass angle per facing, degrees CCW from due-East, at 45-degree steps. "none" is non-directional.
const COMPASS_ANGLE_DEG: Record<Facing, number | undefined> = {
    E: 0,
    NE: 45,
    N: 90,
    NW: 135,
    W: 180,
    SW: 225,
    S: 270,
    SE: 315,
    none: undefined,
};

export function compassPosition(facing: Facing): RosePosition | undefined {
    const deg = COMPASS_ANGLE_DEG[facing];
    if (deg === undefined) return undefined;
    const rad = (deg * Math.PI) / 180;
    // Negate the sine: screen y grows downward, so a northern (positive-angle) facing sits ABOVE centre.
    return { dx: Math.cos(rad), dy: -Math.sin(rad) };
}

type CompassLayout = { mode: "compass"; tiles: { seq: SequenceView; pos: RosePosition }[] };
type GridLayout = { mode: "grid"; tiles: { seq: SequenceView; index: number }[] };

/**
 * Compass rose when every sequence maps to a unique compass facing (FRM's 6, or an 8-facing BAM);
 * grid fallback otherwise (non-directional, or duplicate facings, which cannot share one position).
 */
export function layoutSequences(view: AnimationView): CompassLayout | GridLayout {
    const facings = view.sequences.map((seq) => seq.facing);
    const allCompass = facings.every((facing) => compassPosition(facing) !== undefined);
    const allUnique = new Set(facings).size === facings.length;

    if (allCompass && allUnique) {
        const tiles = view.sequences.flatMap((seq) => {
            const pos = compassPosition(seq.facing);
            return pos === undefined ? [] : [{ seq, pos }];
        });
        return { mode: "compass", tiles };
    }

    return { mode: "grid", tiles: view.sequences.map((seq, index) => ({ seq, index })) };
}
