/**
 * Pins the public surface of @bgforge/animation against the symbols its actual consumer imports: the VS Code
 * client - the animation editor (`client/src/image-editor`), the IE resource viewer (`client/src/ie-resources`)
 * and the image gallery (`client/src/gallery`). The `./group-labels` subpath is a separate surface, split so a
 * browser bundle can reach the labels without this barrel's Node-only codecs, and is not pinned here. Adding a
 * new public symbol requires extending this list; removing one fails this test before the client sees the break.
 */

import { describe, it, expect } from "vitest";
import * as animation from "@bgforge/animation";
import type {
    ActionScheme,
    AnimationIndexResolver,
    AnimationSet,
    ConversionTarget,
    GameHandle,
    GameSource,
    MemberWrite,
    SchemeMember,
    SetManifestMember,
    SetManifestSource,
    SetManifestV1,
    SetStance,
    SetTile,
    StanceIo,
} from "@bgforge/animation";

const REQUIRED_VALUE_EXPORTS = [
    // The index: what a game declares
    "animationIdHex",
    "createAnimationIndexResolver",
    "firstArmour",
    "setTitle",
    "readIdsCodes",
    // Schemes and stances
    "schemeForStride",
    "drawnArmourLevels",
    "overlaidStride",
    "replacementPaletteNames",
    "setMembers",
    "setStances",
    "setTile",
    "stanceIo",
    // The neutral model
    "readNeutralSet",
    // Conversion
    "FALLOUT_FRM",
    "IE_16_POINT_FULL",
    "IE_16_POINT_MIRRORED",
    "IE_8_POINT_MIRRORED",
    "IE_8_POINT_PAIRED",
    "convertSet",
    "unfillableSlots",
    "allocateAnimationId",
    // The files a converted set needs beside its art, precomputed rather than described in the notes.
    "declarationFiles",
    "writeAnimationIni",
    "namingForLayout",
    // What an exported set directory declares about itself
    "readSetManifest",
    "writeSetManifest",
    // Display labels
    "armourLabel",
    "familyDescription",
    "sectionLabel",
    "sectionOptions",
] as const;

/**
 * The public TYPE surface, pinned by naming each type in a signature.
 *
 * Enforced by `tsc --noEmit` (the typecheck gate), not by the assertion below: vitest strips types, so a type
 * dropped from the barrel fails this file's COMPILE, never its run.
 *
 * Never called; the arity assertion keeps the count honest so a name cannot be quietly dropped along with its
 * parameter. Extend it alongside REQUIRED_VALUE_EXPORTS when a public type is added.
 */
function pinPublicTypes(
    resolver: AnimationIndexResolver,
    set: AnimationSet,
    game: GameHandle,
    source: GameSource,
    scheme: ActionScheme,
    member: SchemeMember,
    stance: SetStance,
    stanceIo: StanceIo,
    tile: SetTile,
    write: MemberWrite,
    target: ConversionTarget,
    manifest: SetManifestV1,
    manifestMember: SetManifestMember,
    manifestSource: SetManifestSource,
): number {
    return [
        resolver,
        set,
        game,
        source,
        scheme,
        member,
        stance,
        stanceIo,
        tile,
        write,
        target,
        manifest,
        manifestMember,
        manifestSource,
    ].length;
}

describe("@bgforge/animation public API", () => {
    it("exports every public type by name", () => {
        expect(pinPublicTypes).toHaveLength(14);
    });

    for (const name of REQUIRED_VALUE_EXPORTS) {
        it(`exports ${name}`, () => {
            expect((animation as Record<string, unknown>)[name]).toBeDefined();
        });
    }

    it("exports nothing beyond the pinned surface", () => {
        expect(Object.keys(animation).sort()).toEqual([...REQUIRED_VALUE_EXPORTS].sort());
    });
});
