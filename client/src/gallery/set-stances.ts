/**
 * One animation set's stance list, resolved against the archive.
 *
 * The two halves this joins are deliberately separate: `members.ts` and `character.ts` decide WHICH files
 * a set draws, `bands.ts` decides how a file's cycles divide into stances and what to call them. This is
 * the only place that reads bytes, so both stay unit-testable without a game.
 */
import { readBamV1Tables } from "@bgforge/image";
import { ieBandsOfStride, interpretIeDirections } from "@bgforge/image/ie-direction";
import { type AnimationSet } from "../ie-resources/animation-index";
import { characterActions, characterMember } from "../ie-resources/animation-schemes/character";
import { type FileBands, type SetStance, stancesOfMembers } from "../ie-resources/animation-schemes/bands";
import { type SchemeMember, schemeMembers } from "../ie-resources/animation-schemes/members";
import { actionLabel } from "./facet-browser";

export interface StanceIo {
    exists(resref: string): boolean;
    read(resref: string): Uint8Array | undefined;
}

/** The lowest armour level a set declares - what a viewer opens on when the caller names none. */
export function firstArmour(set: AnimationSet): number | undefined {
    return [...set.prefixByArmour.keys()].sort((a, b) => a - b)[0];
}

/**
 * The files this set draws at one armour level.
 *
 * The paperdoll is excluded: it is a single inventory image with no facings, so it belongs beside the
 * stance list rather than in it - a rose drawn from it would announce a direction the file does not have.
 */
function membersOf(set: AnimationSet, armour: number, exists: (resref: string) => boolean): SchemeMember[] {
    if (set.scheme.kind === "character") {
        return characterActions(set, armour, exists)
            .filter((action) => action.kind !== "paperdoll")
            .flatMap((action) => {
                const resref = characterMember(set, armour, action);
                // A character action is one file: its armour levels are separate members, not parts.
                return resref === undefined ? [] : [{ label: actionLabel(action), resref, parts: [resref] }];
            });
    }
    if (set.layout === undefined) return [];
    return schemeMembers(set.layout, set.prefixByArmour.get(armour), exists);
}

/**
 * Cut one file's cycles into direction bands.
 *
 * A set that declares its stride is banded at it; the rest fall back to reading the block structure,
 * which is what a lone file offers and what the image editor has always done.
 */
function bandsOf(bytes: Uint8Array, stride: number | undefined): FileBands | undefined {
    let tables;
    try {
        tables = readBamV1Tables(bytes);
    } catch {
        // One unreadable member is a missing row, not a dead list - the posture the index takes too.
        return undefined;
    }
    if (stride !== undefined) {
        const bands = ieBandsOfStride(tables.sequences, tables.frameCount, stride);
        // A declared stride carries no block scheme, so such bands are numbered rather than named.
        return bands === undefined ? undefined : { bands, scheme: undefined };
    }
    const analysis = interpretIeDirections(tables.sequences, tables.frameCount);
    return analysis === undefined ? undefined : { bands: analysis.groups, scheme: analysis.scheme };
}

/** Every stance this set offers at one armour level, in the order a viewer should list them. */
export function setStances(set: AnimationSet, armour: number, io: StanceIo): SetStance[] {
    return stancesOfMembers(membersOf(set, armour, io.exists), (resref) => {
        const bytes = io.read(resref);
        return bytes === undefined ? undefined : bandsOf(bytes, set.bandStride);
    });
}
