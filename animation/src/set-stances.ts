/**
 * One animation set's stance list, resolved against the archive.
 *
 * The two halves this joins are deliberately separate: `members.ts` and `character.ts` decide WHICH files
 * a set draws, `bands.ts` decides how a file's cycles divide into stances and what to call them. This is
 * the only place that reads bytes, so both stay unit-testable without a game.
 */
import { cycleDrawsArt, drawsCycle, readBamV1Tables } from "@bgforge/image";
import {
    ieBandsOfStride,
    interpretIeDirections,
    type IeDirectionSlot,
    type SequenceShape,
} from "@bgforge/image/ie-direction";
import { type AnimationSet } from "./animation-index";
import { characterActionCode, characterActions, characterMember } from "./animation-schemes/character";
import { decodeActionCode } from "./animation-schemes/actions";
import { type FileBands, type SetStance, schemeForStride, stancesOfMembers } from "./animation-schemes/bands";
import { layerLabel } from "./animation-schemes/layers";
import { type SchemeMember, schemeMembers } from "./animation-schemes/members";
import { actionLabel } from "./facet-labels";

export interface StanceIo {
    exists(resref: string): boolean;
    read(resref: string): Uint8Array | undefined;
}

/**
 * The files this set draws at one armour level, the inventory paperdoll among them.
 *
 * Exported because a member is the unit an ACTION picker offers, where a stance is the unit a rose draws:
 * one file packs several direction bands, so the stances below are many-to-one on these. The paperdoll is
 * one of those units - it is a member of the set, and a conversion that dropped it would leave the reader
 * to notice the missing inventory image themselves. What it is NOT is a stance, which `setStances` says.
 */
export function setMembers(set: AnimationSet, armour: number, exists: (resref: string) => boolean): SchemeMember[] {
    if (set.scheme.kind === "character") {
        return characterActions(set, armour, exists).flatMap((action) => {
            const resref = characterMember(set, armour, action);
            if (resref === undefined) return [];
            // A character action is one file. The older layout ships a second one holding the facings
            // the engine mirrors for everyone else, so where it exists it is a PART of this member -
            // its armour levels remain separate members, as they are for every character set.
            const mirrored = `${resref}E`;
            const parts = exists(mirrored) ? [resref, mirrored] : [resref];
            return [
                {
                    label: actionLabel(action),
                    action: decodeActionCode("character", characterActionCode(action)),
                    resref,
                    parts,
                },
            ];
        });
    }
    const layout = set.layout;
    if (layout === undefined) return [];
    const label = layerLabel(set.section);
    return [
        ...schemeMembers(layout, set.prefixByArmour.get(armour), exists),
        // After the base members, not interleaved: a layer numbers its cycles exactly as the base does, so
        // a reader scanning the picker sees each family's own run rather than alternating pairs.
        ...(set.layerPrefixes ?? []).flatMap((prefix) => schemeMembers(layout, prefix, exists, label)),
    ];
}

/** One file's cycle table, which is all the band reading needs - no frame is decoded here. */
interface PartTables {
    sequences: SequenceShape[];
    frameCount: number;
    /** Each frame's pixel count, so a cycle can be asked whether it draws anything without decoding one. */
    frameAreas: number[];
}

/**
 * The cycle table of a whole member, plus which of its cycles hold art at all.
 *
 * No frame areas of its own: a merged cycle's refs index the frame table of the PART it came from, so the
 * areas are only meaningful beside their own part and the reading they support is already taken below.
 */
interface MergedTables {
    sequences: SequenceShape[];
    frameCount: number;
    holdsArt: boolean[];
}

/** Whether a cycle opens on a frame that draws something rather than on a placeholder. */
function cycleHoldsArt(sequence: SequenceShape | undefined, areas: readonly number[]): boolean {
    return sequence !== undefined && cycleDrawsArt(sequence.frameRefs, areas);
}

/**
 * The cycle table of a member's whole picture.
 *
 * Per cycle, a part that DRAWS it beats one that only holds a placeholder for it - `drawsCycle` is the
 * composer's own test, so what the band reads and what the viewer draws agree by construction. Reading
 * the first part alone would report a slot as unstored while a sibling file holds its art, which is
 * exactly the unmirrored layouts, whose eastern twin holds the facings the base file pads.
 *
 * Where SEVERAL parts draw one cycle the first wins, which is also what the pixel composer settles on:
 * measured across both shipped installs, the parts that share a drawn cycle agree on its length in all but
 * a handful of members, and the composer refuses exactly those - so preferring a later part here would
 * make the bands describe a picture that then falls back to the base file alone. Cycle indices line up
 * across parts, so a merged entry addresses the same cycle of the composed animation.
 */
function mergedTables(parts: PartTables[]): MergedTables | undefined {
    const [first] = parts;
    if (first === undefined) return undefined;
    // The longest part's table, not the first's: a twin holding only the facings it draws still reaches the
    // cycle positions those sit at, and the base file stops short of them - the same spine the composer
    // follows, so the bands read here and the picture drawn from them span the same cycles.
    const spine = parts.reduce(
        (longest, part) => (part.sequences.length > longest.length ? part.sequences : longest),
        first.sequences,
    );
    const sequences = spine.map(
        (seq, cycle) => parts.map((part) => part.sequences[cycle]).find((candidate) => drawsCycle(candidate)) ?? seq,
    );
    // Judged per part, because a cycle's refs index the frame table of the file they came from - and a
    // cycle draws where ANY part holds pixels for it, which is the same reading the merge above takes.
    return {
        frameCount: Math.max(...parts.map((part) => part.frameCount)),
        sequences,
        holdsArt: sequences.map((_, cycle) =>
            parts.some((part) => cycleHoldsArt(part.sequences[cycle], part.frameAreas)),
        ),
    };
}

/**
 * Cut a member's cycles into direction bands.
 *
 * A set that declares its stride is banded at it; the rest fall back to reading the block structure,
 * which is what a lone file offers and what the image editor has always done.
 */
function bandsOf(
    parts: readonly (Uint8Array | undefined)[],
    stride: number | undefined,
    coarse: boolean,
): FileBands | undefined {
    const tables: PartTables[] = [];
    for (const bytes of parts) {
        if (bytes === undefined) continue;
        try {
            tables.push(readBamV1Tables(bytes));
        } catch {
            // One unreadable part is a lost piece, not a dead row - the posture the index takes too.
        }
    }
    const merged = mergedTables(tables);
    if (merged === undefined) return undefined;
    /** A band draws where any of its cycles holds art - the rest are the skeleton a packed file carries. */
    const drawn = (bands: readonly (readonly IeDirectionSlot[])[]): boolean[] =>
        bands.map((slots) => slots.some((slot) => merged.holdsArt[slot.seqIndex] === true));
    if (stride !== undefined) {
        const bands = ieBandsOfStride(merged.sequences, merged.frameCount, stride, coarse);
        // The stride came from the animation's own declared type, so the facings on them are declared too.
        // A stride the block table has a scheme for keeps its stance names; a wider one is numbered.
        return bands === undefined
            ? undefined
            : { bands, drawn: drawn(bands), scheme: schemeForStride(stride), confidence: "declared" };
    }
    const analysis = interpretIeDirections(merged.sequences, merged.frameCount);
    if (analysis === undefined) return undefined;
    // `detected` is the interpreter's own strong fingerprint for the scheme it chose; without it the
    // facings are a reading of block structure, good enough to draw and not to write a target from.
    return {
        bands: analysis.groups,
        drawn: drawn(analysis.groups),
        scheme: analysis.scheme,
        confidence: analysis.detected ? "declared" : "inferred",
    };
}

/** Whether a member is the inventory paperdoll rather than something a rose can be drawn from. */
export function isPaperdoll(member: SchemeMember): boolean {
    return member.action.id === "paperdoll";
}

/**
 * Every stance this set offers at one armour level, in the order a viewer should list them.
 *
 * The paperdoll is dropped here rather than by `setMembers`: it is a single inventory image and, measured
 * across both installs, always exactly one cycle - so a rose drawn from it would announce a direction the
 * file does not have. It stays a member, which is what carries it through a conversion.
 */
export function setStances(set: AnimationSet, armour: number, io: StanceIo): SetStance[] {
    const members = setMembers(set, armour, io.exists).filter((member) => !isPaperdoll(member));
    return stancesOfMembers(
        members,
        (member) =>
            bandsOf(
                member.parts.map((resref) => io.read(resref)),
                set.bandStride,
                set.coarseBands === true,
            ),
        set.section,
    );
}
