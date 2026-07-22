import { type Facing, FRM_FACINGS } from "../model/animation.ts";

export const FRM_FACING_SET: ReadonlySet<Facing> = new Set<Facing>(FRM_FACINGS);

// IE orientation order, 0=South increasing counter-clockwise (IESDP ini_spawn.htm:
// 0=south, 4=west, 8=north, 12=east on the 0..15 scale; the 8-direction set is every other step).
export const IE8_FACINGS: readonly Facing[] = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];

export function facingsForCycleCount(count: number): Facing[] | null {
    if (count === 8) return [...IE8_FACINGS];
    if (count === 6) return [...FRM_FACINGS];
    return null; // 5/9/16/other schemes need an explicit layout (slot-modeling deferred)
}

export function partitionForFrm(facings: Facing[]): { kept: number[]; dropped: number[] } {
    const kept: number[] = [];
    const dropped: number[] = [];
    facings.forEach((f, i) => (FRM_FACING_SET.has(f) ? kept : dropped).push(i));
    return { kept, dropped };
}

export function frmSlotOrder(facings: Facing[]): number[] {
    return FRM_FACINGS.map((slot) => facings.indexOf(slot));
}
