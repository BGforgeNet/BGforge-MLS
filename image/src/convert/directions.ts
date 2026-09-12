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

// Matched by facing NAME, which is also the EXACT angular match: both engines draw their diagonals at the
// same visible angle, arctan(3/4) or about 36.9 degrees above the horizontal. Fallout reaches it through
// its tile grid, which steps 32 across for every 24 down; the IE through art rendered at even 22.5-degree
// world azimuths onto a ground plane that compresses vertically by three quarters - so a half-step slot
// such as ENE lands about 14 degrees away, and reassigning the diagonals to it is worse, not better.
export function frmSlotOrder(facings: Facing[]): number[] {
    return FRM_FACINGS.map((slot) => facings.indexOf(slot));
}
