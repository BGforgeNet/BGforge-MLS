import { type Facing, FRM_FACINGS } from "../model/animation.ts";

export const FRM_FACING_SET: ReadonlySet<Facing> = new Set<Facing>(FRM_FACINGS);

// IE orientation order, 0=South increasing counter-clockwise (IESDP ini_spawn.htm:
// 0=south, 4=west, 8=north, 12=east on the 0..15 scale; the 8-direction set is every other step).
export const IE8_FACINGS: readonly Facing[] = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];

export function facingsForCycleCount(count: number): Facing[] | null {
    if (count === 8) return [...IE8_FACINGS];
    if (count === 6) return [...FRM_FACINGS];
    return null; // 5/9/16/other schemes rely on the sequences' own facing tags or a single-orientation pick
}

export function frmSlotOrder(facings: Facing[]): number[] {
    return FRM_FACINGS.map((slot) => facings.indexOf(slot));
}
