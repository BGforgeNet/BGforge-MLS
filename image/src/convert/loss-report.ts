export type LossKind =
    | "empty-direction"
    | "mirrored-directions"
    | "padded-sequence"
    /** Every rotation was cut back to the shortest one, so the tails of the longer ones are gone. The
     *  loudest of the uneven-rotation answers and the only one that discards source frames. */
    | "clipped-sequence"
    | "duplicated-shared-frames"
    | "shared-frame-direction-offset"
    | "embedded-palette"
    | "palette-remapped-to-default"
    | "palette-sidecar-required"
    | "alpha-flattened"
    | "colours-quantized"
    /** A creature's colours were written into the output, replacing the animation's placeholder ranges.
     *  A real loss: the result renders as that one creature and can never be recoloured as another. */
    | "creature-colours-baked"
    /** The source stored art for facings the target's wheel has no slot of any kind for - a coarser
     *  direction scheme. Structural, so informational: it fires on every finer-than-target source. */
    | "directions-unrepresentable"
    /** The target SHOWS these facings but stores only the mirrored arc, so drawn eastern art is thrown
     *  away. A real loss, and the one that hides best - the result still animates in every direction. */
    | "drawn-facings-mirrored"
    /** The target's naming has no code for what this action depicts, so it is not written at all. A
     *  completeness loss rather than a per-pixel one: the art survives, the animation loses a move. */
    | "action-unmapped"
    /** The two namings disagree on how finely an action is named - a grip the target does not distinguish,
     *  or a weapon it does and the source never stated. Informational: the art is untouched either way. */
    | "action-code-detail"
    /** Two of the source's actions are ONE animation in the target, drawn from the same frames, so the
     *  second is the file the first already wrote. Informational: nothing is dropped, and reporting it as
     *  unmapped would claim a move was lost when every frame of it is in the output. */
    | "action-shares-target-file"
    /** The target names two files for something the source drew once - two hit reactions, two falls, two
     *  ways of standing up - so the second is written from the first's frames. Informational: the art is
     *  the source's own, under a name its engine loads separately. */
    | "action-name-filled"
    /** A member the source cut across several files was assembled into the one file the target writes.
     *  Informational: it is the picture the parts drew together, and none of it is discarded. */
    | "parts-composed"
    /** The source's engine layers a weapon on from files the item owns and the target draws one into the
     *  art instead, so the result is unarmed. Structural: there was no member here to carry. */
    | "weapon-layer-unrepresentable";

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
    // A coarser target has no slot of that kind at all, so this fires on every finer source and says
    // nothing about THIS one. Per-item it would be the report's loudest entry and its least informative.
    "directions-unrepresentable",
    // A naming difference, not a data one: the art written is the art read, under a name whose precision
    // differs. Worth saying, never worth calling the conversion lossy.
    "action-code-detail",
    // The output holds every frame of both actions - one file the target plays for both. Calling it a loss
    // would mark a conversion lossy for having written exactly what the target's own engine stores.
    "action-shares-target-file",
    // The source is written under a name it did not carry, and loses nothing by it: an engine that loads
    // art by name finds nothing under the second name of a pair, and the clip that filled the first is what
    // the source drew for that event.
    "action-name-filled",
    // An assembly, not a degradation: the parts drew one picture and the output holds all of it.
    "parts-composed",
    // Structural, like the direction one above: there was no weapon member to carry, so this says something
    // about the two engines and nothing about this source. As a loss it would mark every such conversion
    // lossy for a reason unrelated to the art it wrote.
    "weapon-layer-unrepresentable",
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
