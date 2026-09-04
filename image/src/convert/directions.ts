import { type Facing, FRM_FACINGS } from "../model/animation.ts";

export const FRM_FACING_SET: ReadonlySet<Facing> = new Set<Facing>(FRM_FACINGS);

// IE orientation order, 0=South increasing counter-clockwise (IESDP ini_spawn.htm:
// 0=south, 4=west, 8=north, 12=east on the 0..15 scale; the 8-direction set is every other step).
export const IE8_FACINGS: readonly Facing[] = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];

export function facingsForCycleCount(count: number): Facing[] | null {
    if (count === 8) return [...IE8_FACINGS];
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
