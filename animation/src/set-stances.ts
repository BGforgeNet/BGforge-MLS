/**
 * One animation set's stance list, resolved against the archive.
 *
 * The two halves this joins are deliberately separate: `members.ts` and `character.ts` decide WHICH files
 * a set draws, `bands.ts` decides how a file's cycles divide into stances and what to call them. This is
 * the only place that reads bytes, so both stay unit-testable without a game.
 */
import { readBamV1Tables } from "@bgforge/image";
import {
    ieBandsOfStride,
    interpretIeDirections,
    type IeDirectionSlot,
    type IeScheme,
} from "@bgforge/image/ie-direction";
import { type MergedTables, type PartTables, mergeParts } from "./animation-schemes/part-tables";
import { type AnimationSet, armourLevels } from "./animation-index";
import {
    characterActionCode,
    characterActions,
    characterMember,
    characterOwnBand,
} from "./animation-schemes/character";
import { decodeActionCode } from "./animation-schemes/actions";
import {
    type FileBands,
    type SetStance,
    bandsOverlaying,
    schemeForStride,
    stancesOfMembers,
} from "./animation-schemes/bands";
import { layerLabel } from "./animation-schemes/layers";
import { type SchemeMember, schemeMembers } from "./animation-schemes/members";
import { actionLabel } from "./facet-labels";
import type { GameHandle } from "./game-handle";

export interface StanceIo {
    exists(resref: string): boolean;
    read(resref: string): Uint8Array | undefined;
}

/** Reads a set's members out of an open game, treating an unreadable member as a missing one. */
export function stanceIo(game: Pick<GameHandle, "canRead" | "read">): StanceIo {
    const read = (resref: string): Uint8Array | undefined => {
        if (!game.canRead(resref, "bam")) return undefined;
        try {
            return game.read(resref, "bam");
        } catch {
            // One unreadable member is a missing row, not a dead page - the posture the index takes too.
            return undefined;
        }
    };
    return { exists: (resref) => game.canRead(resref, "bam"), read };
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
        const actions = characterActions(set, armour, exists);
        // A set draws the misc skeleton one of two ways: packed into a single file holding every band, or
        // split across one file per band with each carrying its neighbours' bands as copies. Only the split
        // one shares, and the archive is what says which - a lone misc file holds the whole skeleton and
        // has to offer all of it, where a file with siblings offers the band it is named for.
        const split = actions.filter((action) => action.kind === "misc").length > 1;
        return actions.flatMap((action) => {
            const resref = characterMember(set, armour, action, exists);
            if (resref === undefined) return [];
            // A character action is one file. The older layout ships a second one holding the facings
            // the engine mirrors for everyone else, so where it exists it is a PART of this member -
            // its armour levels remain separate members, as they are for every character set.
            const mirrored = `${resref}E`;
            const parts = exists(mirrored) ? [resref, mirrored] : [resref];
            // Name and label alike: this scheme's own action names ARE the stance ("Cast", "Shoot (bow)"),
            // and a misc file takes the name of the one band it draws, so neither form carries a code.
            const label = actionLabel(action);
            const code = characterActionCode(action);
            return [
                {
                    label,
                    name: label,
                    action: decodeActionCode("character", code),
                    resref,
                    parts,
                    ...(split && characterOwnBand(code) !== undefined ? { ownBand: characterOwnBand(code) } : {}),
                },
            ];
        });
    }
    const layout = set.layout;
    if (layout === undefined) return [];
    const label = layerLabel(set.section);
    const base = schemeMembers(layout, set.prefixByArmour.get(armour), exists);
    // Which base member each overlay is drawn over, keyed on the cycle code both were built from rather
    // than on the label - the layer's label has the family's name appended, and pairing on it would be
    // reading a relation back out of display text.
    const baseByCode = new Map(base.map((member) => [member.action.code, member.resref]));
    return [
        ...base,
        // After the base members, not interleaved: a layer numbers its cycles exactly as the base does, so
        // a reader scanning the picker sees each family's own run rather than alternating pairs. Order is
        // also what lets the band reader have the base's answer in hand before it reaches the overlay.
        ...(set.layerPrefixes ?? []).flatMap((prefix) =>
            schemeMembers(layout, prefix, exists, label).map((member) => {
                const over = baseByCode.get(member.action.code);
                return over === undefined ? member : { ...member, overlays: over };
            }),
        ),
    ];
}

/**
 * A file whose cycles fit no direction scheme, as ONE band holding all of them.
 *
 * Every stance is a band, so a member no scheme reads contributes no row and its art is unreachable - and a
 * set whose only member reads that way could not be opened at all, refused with the message for an install
 * that ships nothing. The effect families are where this lands: a gib splatter stores ten unrelated
 * pictures, and no arrangement of facings divides them.
 *
 * The slots carry no facing, which is the reading rather than a gap in it. Cycles holding no art are left
 * out, the same way `partitionBlocks` drops them, so an empty file still yields no stance.
 */
function wholeFileBand(merged: MergedTables): FileBands {
    const slots: IeDirectionSlot[] = merged.sequences.flatMap((_, seqIndex) =>
        merged.holdsArt[seqIndex] === true ? [{ seqIndex, facing: "none" as const }] : [],
    );
    return { bands: [slots], artCycles: [slots.length], scheme: undefined, confidence: "inferred" };
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
    overlaying?: FileBands,
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
    /** How many of each band's cycles hold art - a band with none is the skeleton a packed file carries. */
    const artCycles = (bands: readonly (readonly IeDirectionSlot[])[]): number[] =>
        bands.map((slots) => slots.filter((slot) => merged.holdsArt[slot.seqIndex] === true).length);
    if (overlaying !== undefined) {
        // The geometry and the scheme are the base's; which of those bands DRAW stays this file's own,
        // since an overlay need not cover every stance the thing it is drawn over has.
        const bands = bandsOverlaying(overlaying, merged.sequences.length);
        return { bands, artCycles: artCycles(bands), scheme: overlaying.scheme, confidence: overlaying.confidence };
    }
    if (stride !== undefined) {
        const bands = ieBandsOfStride(merged.sequences, merged.frameCount, stride, coarse);
        // The stride came from the animation's own declared type, so the facings on them are declared too.
        // A stride the block table has a scheme for keeps its stance names; a wider one is numbered.
        return bands === undefined
            ? undefined
            : { bands, artCycles: artCycles(bands), scheme: schemeForStride(stride), confidence: "declared" };
    }
    const analysis = interpretIeDirections(merged.sequences, merged.frameCount);
    if (analysis === undefined) return wholeFileBand(merged);
    // `detected` is the interpreter's own strong fingerprint for the scheme it chose; without it the
    // facings are a reading of block structure, good enough to draw and not to write a target from.
    return {
        bands: analysis.groups,
        artCycles: artCycles(analysis.groups),
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
        (member, overlaying) =>
            bandsOf(
                member.parts.map((resref) => io.read(resref)),
                set.bandStride,
                set.coarseBands === true,
                overlaying,
            ),
        set.section,
    );
}

/**
 * The band width to read an overlay member at: the one the member it is drawn over is read at.
 *
 * For a surface that bands ONE member and so cannot see the base - the editor panel reinterprets whatever
 * member is open, and an overlay's own files need not carry the structure to cut on (`bandsOverlaying`).
 * Undefined where the member overlays nothing, or where the base's bands are not all one width: a stride
 * cannot express those, and inventing one would cut the overlay somewhere the base does not.
 *
 * A base read as ONE whole-file band (`wholeFileBand`) would lend its cycle count as a stride, which is not
 * one. Left unguarded: no overlay in the three measured installs sits over such a base, and a guard for a
 * pairing no install ships would be untested code on the path every real overlay takes.
 */
export function overlaidStride(
    set: AnimationSet,
    armour: number,
    io: StanceIo,
    member: SchemeMember,
): { stride: number; scheme?: IeScheme } | undefined {
    if (member.overlays === undefined) return undefined;
    const base = setMembers(set, armour, io.exists).find((row) => row.resref === member.overlays);
    if (base === undefined) return undefined;
    const bands = bandsOf(
        base.parts.map((resref) => io.read(resref)),
        set.bandStride,
        set.coarseBands === true,
    );
    const stride = bands?.bands[0]?.length;
    if (bands === undefined || stride === undefined) return undefined;
    if (!bands.bands.every((slots) => slots.length === stride)) return undefined;
    return { stride, ...(bands.scheme === undefined ? {} : { scheme: bands.scheme }) };
}
