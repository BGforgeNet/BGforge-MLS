/**
 * One animation set's stance list, resolved against the archive.
 *
 * The two halves this joins are deliberately separate: `members.ts` and `character.ts` decide WHICH files
 * a set draws, `bands.ts` decides how a file's cycles divide into stances and what to call them. This is
 * the only place that reads bytes, so both stay unit-testable without a game.
 */
import { drawsCycle, readBamV1Tables } from "@bgforge/image";
import { ieBandsOfStride, interpretIeDirections, type SequenceShape } from "@bgforge/image/ie-direction";
import { type AnimationSet } from "./animation-index";
import { characterActions, characterMember } from "./animation-schemes/character";
import { type FileBands, type SetStance, schemeForStride, stancesOfMembers } from "./animation-schemes/bands";
import { type SchemeMember, schemeMembers } from "./animation-schemes/members";
import { actionLabel } from "./facet-browser";

export interface StanceIo {
    exists(resref: string): boolean;
    read(resref: string): Uint8Array | undefined;
}

/**
 * The files this set draws at one armour level.
 *
 * The paperdoll is excluded: it is a single inventory image with no facings, so it belongs beside the
 * stance list rather than in it - a rose drawn from it would announce a direction the file does not have.
 *
 * Exported because a member is the unit an ACTION picker offers, where a stance is the unit a rose draws:
 * one file packs several direction bands, so the stances below are many-to-one on these.
 */
export function setMembers(set: AnimationSet, armour: number, exists: (resref: string) => boolean): SchemeMember[] {
    if (set.scheme.kind === "character") {
        return characterActions(set, armour, exists)
            .filter((action) => action.kind !== "paperdoll")
            .flatMap((action) => {
                const resref = characterMember(set, armour, action);
                if (resref === undefined) return [];
                // A character action is one file. The older layout ships a second one holding the facings
                // the engine mirrors for everyone else, so where it exists it is a PART of this member -
                // its armour levels remain separate members, as they are for every character set.
                const mirrored = `${resref}E`;
                const parts = exists(mirrored) ? [resref, mirrored] : [resref];
                return [{ label: actionLabel(action), resref, parts }];
            });
    }
    if (set.layout === undefined) return [];
    return schemeMembers(set.layout, set.prefixByArmour.get(armour), exists);
}

/** One file's cycle table, which is all the band reading needs - no frame is decoded here. */
interface PartTables {
    sequences: SequenceShape[];
    frameCount: number;
}

/**
 * The cycle table of a member's whole picture.
 *
 * Per cycle, a part that DRAWS it beats one that only holds a placeholder for it - `drawsCycle` is the
 * composer's own test, so what the band reads and what the viewer draws agree by construction. Reading
 * the first part alone would report a slot as unstored while a sibling file holds its art, which is
 * exactly the older character layout, whose mirrored twin holds the eastern facings the base file pads.
 * Cycle indices line up across parts, so a merged entry addresses the same cycle of the composed
 * animation.
 */
function mergedTables(parts: PartTables[]): PartTables | undefined {
    const [first, ...rest] = parts;
    if (first === undefined) return undefined;
    if (rest.length === 0) return first;
    return {
        frameCount: Math.max(...parts.map((part) => part.frameCount)),
        sequences: first.sequences.map((seq, cycle) =>
            drawsCycle(seq)
                ? seq
                : (parts.map((part) => part.sequences[cycle]).find((candidate) => drawsCycle(candidate)) ?? seq),
        ),
    };
}

/**
 * Cut a member's cycles into direction bands.
 *
 * A set that declares its stride is banded at it; the rest fall back to reading the block structure,
 * which is what a lone file offers and what the image editor has always done.
 */
function bandsOf(parts: readonly (Uint8Array | undefined)[], stride: number | undefined): FileBands | undefined {
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
    if (stride !== undefined) {
        const bands = ieBandsOfStride(merged.sequences, merged.frameCount, stride);
        // The stride came from the animation's own declared type, so the facings on them are declared too.
        // A stride the block table has a scheme for keeps its stance names; a wider one is numbered.
        return bands === undefined ? undefined : { bands, scheme: schemeForStride(stride), confidence: "declared" };
    }
    const analysis = interpretIeDirections(merged.sequences, merged.frameCount);
    if (analysis === undefined) return undefined;
    // `detected` is the interpreter's own strong fingerprint for the scheme it chose; without it the
    // facings are a reading of block structure, good enough to draw and not to write a target from.
    return {
        bands: analysis.groups,
        scheme: analysis.scheme,
        confidence: analysis.detected ? "declared" : "inferred",
    };
}

/** Every stance this set offers at one armour level, in the order a viewer should list them. */
export function setStances(set: AnimationSet, armour: number, io: StanceIo): SetStance[] {
    return stancesOfMembers(setMembers(set, armour, io.exists), (member) =>
        bandsOf(
            member.parts.map((resref) => io.read(resref)),
            set.bandStride,
        ),
    );
}
