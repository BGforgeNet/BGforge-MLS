/**
 * Read one animation set into the neutral model.
 *
 * This is the only place that turns an install's bytes into the model, and it deliberately does the least
 * it can: it resolves WHICH files the set draws (the scheme layer already answers that), parses each one
 * once, and records the interpretation that says which stored cycle is which facing. The parsed animations
 * are kept exactly as the codec produced them - see `model.ts` for why that is the whole point.
 */
import { type Animation, loadImage } from "@bgforge/image";
import { type IeDirectionSlot } from "@bgforge/image/ie-direction";
import { type AnimationSet, armourLevels } from "../animation-index";
import { type BandConfidence } from "../animation-schemes/bands";
import { setStances, type StanceIo } from "../set-stances";
import { type NeutralAction, type NeutralCycles, type NeutralSet, type NeutralVariant } from "./model";

export interface NeutralReadOptions {
    /** The flavour the set was read from, recorded on the identity - "tob", "bgee", ... */
    flavour: string;
}

/**
 * Parse one member file, or undefined where it cannot be read.
 *
 * A file that will not parse is a lost part rather than a dead set, which is the posture every layer below
 * this one already takes. BAM v2 is not reachable here: its frames live in separate PVRZ pages that only a
 * caller holding the archive can resolve, so `loadImage` refuses it by design and it lands in this catch.
 */
function parseMember(resref: string, io: StanceIo): Animation | undefined {
    const bytes = io.read(resref);
    if (bytes === undefined) return undefined;
    try {
        return loadImage(bytes, `${resref}.BAM`);
    } catch {
        return undefined;
    }
}

/**
 * The band's cycles as neutral directions.
 *
 * A band the interpreter could only INFER facings for is recorded as an ordered cycle list instead: the
 * indices are the same either way, and claiming a compass direction the file never declared is how a
 * converter would come to write a target's south slot from a cycle that is not one.
 */
function cyclesOf(slots: readonly IeDirectionSlot[], confidence: BandConfidence): NeutralCycles {
    if (confidence !== "declared") {
        return { kind: "ordered", sequenceIndices: slots.map((slot) => slot.seqIndex) };
    }
    return {
        kind: "directional",
        directions: slots.map((slot) => ({ facing: slot.facing, sequenceIndex: slot.seqIndex })),
    };
}

export function readNeutralSet(set: AnimationSet, io: StanceIo, options: NeutralReadOptions): NeutralSet {
    const variants: NeutralVariant[] = [];
    for (const armour of armourLevels(set)) {
        const stances = setStances(set, armour, io);
        if (stances.length === 0) continue;

        const files = new Map<string, Animation>();
        const actions: NeutralAction[] = [];
        for (const stance of stances) {
            for (const resref of stance.parts) {
                if (files.has(resref)) continue;
                const parsed = parseMember(resref, io);
                if (parsed !== undefined) files.set(resref, parsed);
            }
            // Every part unreadable means the band was read from nothing this model can carry; the stance
            // layer tolerated it because it only needed one part's cycle table.
            const drawn = stance.parts.filter((resref) => files.has(resref));
            if (drawn.length === 0) continue;
            actions.push({
                label: stance.label,
                resrefs: drawn,
                band: stance.band,
                cycles: cyclesOf(stance.slots, stance.confidence),
            });
        }
        if (actions.length > 0) variants.push({ armour, files, actions });
    }

    return {
        identity: {
            sourceId: set.id,
            code: set.code,
            name: set.name,
            sourceFlavour: options.flavour,
            sourceSection: set.section,
        },
        variants,
    };
}
