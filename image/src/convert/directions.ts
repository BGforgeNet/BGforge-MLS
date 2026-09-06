import { type Facing, FRM_FACINGS } from "../model/animation.ts";
import { IE_STRIDE, ieFacingsForStride } from "../model/ie-direction.ts";

export const FRM_FACING_SET: ReadonlySet<Facing> = new Set<Facing>(FRM_FACINGS);

// Read from the direction model rather than restated: that module owns the stored-cycle order for every IE
// scheme, so a correction there reaches this conversion path instead of leaving two copies to diverge.
export const IE8_FACINGS: readonly Facing[] = ieFacingsForStride(IE_STRIDE);

export function facingsForCycleCount(count: number): Facing[] | null {
    if (count === IE_STRIDE) return [...IE8_FACINGS];
    if (count === 6) return [...FRM_FACINGS];
    // Everything else reaches FRM already facing-tagged - an IE creature block is extracted and tagged
    // by the direction interpretation first - or as a single-orientation pick.
    return null;
}

// Matched by facing NAME, which is also the closest ANGULAR match. Fallout's hex axes are
// foreshortened on screen - a walk cycle's accumulated frame offsets, which are motion deltas, run
// ~36.3 degrees above the horizontal across the corpus - against the IE wheel's even 22.5-degree
// screen spacing, so a diagonal slot sits ~8.7 degrees off its IE namesake and ~13.8 off the nearest
// half-step; reassigning the diagonals to ENE/ESE/WSW/WNW is measurably worse, not better.
export function frmSlotOrder(facings: Facing[]): number[] {
    return FRM_FACINGS.map((slot) => facings.indexOf(slot));
}
