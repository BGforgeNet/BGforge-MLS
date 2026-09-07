/**
 * One animation set's stance list, resolved against the archive.
 *
 * The two halves this joins are deliberately separate: `members.ts` and `character.ts` decide WHICH files
 * a set draws, `bands.ts` decides how a file's cycles divide into stances and what to call them. This is
 * the only place that reads bytes, so both stay unit-testable without a game.
 */
import { readBamV1Tables } from "@bgforge/image";
import { ieBandsOfStride, interpretIeDirections, type IeDirectionSlot } from "@bgforge/image/ie-direction";
import { type PartTables, mergeParts } from "./animation-schemes/part-tables";
import { type AnimationSet, armourLevels } from "./animation-index";
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
            const resref = characterMember(set, armour, action, exists);
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
    const merged = mergeParts(tables);
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
        // A merge across parts is itself the identification. The fingerprint the interpreter looks for is a
        // base file's PADDED eastern slots, and merging the twin fills exactly those - so a member that
        // pairs loses the mark while gaining the art it names, and its facings would come back as a bare
        // cycle list a converter into a mirroring target would silently drop the eastern frames of. Only
        // the unmirrored schemes divide a picture between files this way: a spatial split hands every
        // cycle to the same part, since its quarters draw the same moments.
        confidence: analysis.detected || merged.contributors > 1 ? "declared" : "inferred",
    };
}

/** Whether a member is the inventory paperdoll rather than something a rose can be drawn from. */
export function isPaperdoll(member: SchemeMember): boolean {
    return member.action.id === "paperdoll";
}

/**
 * The armour levels this set actually draws a body at, lowest first.
 *
 * The DECLARED count belongs to the animation family, not to the install: a classic archive ships no
 * plate-armoured thief, so offering the declared four hands the reader three empty rows. Both reference
 * implementations derive the count from the archive for the same reason.
 *
 * The paperdoll is excluded because it is keyed by its own prefix: a level whose only surviving file is an
 * inventory image draws no body, and counting it would offer a level nothing animates at.
 */
export function drawnArmourLevels(set: AnimationSet, exists: (resref: string) => boolean): number[] {
    return armourLevels(set).filter((level) => setMembers(set, level, exists).some((member) => !isPaperdoll(member)));
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
