export type LossKind =
    | "empty-direction"
    | "mirrored-directions"
    | "padded-sequence"
    | "duplicated-shared-frames"
    | "shared-frame-direction-offset"
    | "embedded-palette"
    | "palette-remapped-to-default"
    | "palette-sidecar-required"
    | "alpha-flattened"
    | "colours-quantized";

export interface LossItem {
    kind: LossKind;
    detail: string;
}

// Some conversion notes record a representation change that loses NO source data: colours stay
// identical (a lossless remap to the default palette), frames are all preserved (duplicated to avoid
// cross-direction sharing), or the palette is preserved rather than dropped (embedded in a BAM, or kept
// as a .pal sidecar). They are worth recording, but must NOT make a conversion count as lossy - else a
// clean conversion pops a misleading "Converting will lose..." warning.
const INFORMATIONAL: ReadonlySet<LossKind> = new Set<LossKind>([
    "palette-remapped-to-default",
    "embedded-palette",
    "duplicated-shared-frames",
    "palette-sidecar-required",
    // Mirrored east rotations ADD engine-faithful data (what playback shows anyway); nothing is lost.
    "mirrored-directions",
]);

export class LossReport {
    readonly items: LossItem[] = [];

    add(kind: LossKind, detail: string): void {
        this.items.push({ kind, detail });
    }

    /** Items that represent real data loss or degradation - excludes the informational notes above. */
    get losses(): LossItem[] {
        return this.items.filter((item) => !INFORMATIONAL.has(item.kind));
    }

    /** True when nothing was actually lost (informational representation changes do not count). */
    get lossless(): boolean {
        return this.losses.length === 0;
    }

    /** Fold another report in, so a conversion that ran in two stages warns about the result once. */
    absorb(other: LossReport): void {
        this.items.push(...other.items);
    }

    has(kind: LossKind): boolean {
        return this.items.some((item) => item.kind === kind);
    }
}
