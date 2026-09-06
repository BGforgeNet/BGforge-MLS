/**
 * Pins the public surface of @bgforge/image against the symbols its actual consumers import: the VS Code
 * image editor and its webview (`client/src/image-editor`), the IE resource viewer's thumbnails and creature
 * index (`client/src/ie-resources`), the gallery worker (`client/src/gallery/worker-core.ts`), the animation
 * library (`animation/src`), and `scripts/bench-thumbnails.mts`. The three Buffer-free subpaths
 * (`./frame-anchor`, `./ie-direction`, `./compose-parts`) are a separate surface and are not pinned here.
 * Adding a new public symbol requires extending this list; removing one fails this test before downstream
 * callers see the break.
 */

import { describe, it, expect } from "vitest";
import * as image from "@bgforge/image";
import type {
    Animation,
    AnimationMeta,
    BamV2PageWrite,
    CreatureColors,
    DirectionLayout,
    Facing,
    Frame,
    FrmConvertOpts,
    IndexedAnimation,
    IndexedSourceFormat,
    LossKind,
    PvrzResolver,
    Rgba,
    RgbaAnimation,
    Sequence,
    SourceFormat,
} from "@bgforge/image";

const REQUIRED_VALUE_EXPORTS = [
    // Shared model
    "FRM_FACINGS",
    "emptyPalette",
    "isRgbaAnimation",
    "mirrorFacing",
    "mirrorFrame",
    "transparentIndexOf",
    "ieFacingsForStride",
    "interpretIeDirections",
    "composeParts",
    "cycleDrawsArt",
    "drawsCycle",
    // Format codecs
    "readBmpRgba",
    "parseFrm",
    "serializeFrm",
    "combineFrmDirections",
    "parseBamV1",
    "decodeBamV1Frames",
    "readBamV1Tables",
    "isBamV2",
    "readBamV2Structure",
    "decodeBamV2",
    "pvrzResourceName",
    "serializeBamV2",
    "serializeBamV1",
    "combineIeBamPair",
    "splitIeBamBlocks",
    "splitIeBamPair",
    "isBamc",
    "decodeBamc",
    "encodeBamc",
    "encodeIndexedPng",
    "encodeTruecolourPng",
    "decodeIndexedPng",
    "decodeTruecolourPng",
    // Palettes
    "parsePal",
    "serializePal",
    "CREATURE_RANGES",
    "applyCreatureColors",
    "creatureColorsAt",
    "parseGradientTable",
    "DEFAULT_FALLOUT_PALETTE",
    "loadImage",
    // Conversion
    "LossReport",
    "convertToBam",
    "convertToBamV2",
    "convertToFrm",
    "convertToIndexed",
    "convertToRgba",
    "frmDirectionMode",
    "needsFreshPages",
    // Import/export codecs
    "exportPngDirectory",
    "importPngDirectory",
    "exportApngPerDirection",
    "importApng",
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
    animation: Animation,
    meta: AnimationMeta,
    indexed: IndexedAnimation,
    rgba: RgbaAnimation,
    sequence: Sequence,
    frame: Frame,
    pixel: Rgba,
    facing: Facing,
    layout: DirectionLayout,
    source: SourceFormat,
    indexedSource: IndexedSourceFormat,
    resolver: PvrzResolver,
    pageWrite: BamV2PageWrite,
    colors: CreatureColors,
    loss: LossKind,
    frmOpts: FrmConvertOpts,
): number {
    return [
        animation,
        meta,
        indexed,
        rgba,
        sequence,
        frame,
        pixel,
        facing,
        layout,
        source,
        indexedSource,
        resolver,
        pageWrite,
        colors,
        loss,
        frmOpts,
    ].length;
}

describe("@bgforge/image public API", () => {
    it("exports every public type by name", () => {
        expect(pinPublicTypes).toHaveLength(16);
    });

    for (const name of REQUIRED_VALUE_EXPORTS) {
        it(`exports ${name}`, () => {
            expect((image as Record<string, unknown>)[name]).toBeDefined();
        });
    }

    it("exports nothing beyond the pinned surface", () => {
        expect(Object.keys(image).sort()).toEqual([...REQUIRED_VALUE_EXPORTS].sort());
    });
});
