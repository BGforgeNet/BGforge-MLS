/**
 * Which layout a fresh open shows.
 *
 * The interesting case is the one this replaced: a character animation whose blocks are mostly the
 * family skeleton's placeholders. Its interpretation is not `detected` - the fingerprint that stamps what
 * the file is DECLARED to be stays conservative on purpose, because the save path reads that stamp - and
 * the default used to inherit that caution, so the file a reader most wants a rose for opened flat.
 */
import { describe, expect, it } from "vitest";
import type { IeDirectionAnalysis } from "@bgforge/image/ie-direction";
import { defaultLayoutMode } from "../../src/image-editor/webview/render/compass-layout";

const analysis = (blocks: number, detected: boolean): IeDirectionAnalysis => ({
    groups: Array.from({ length: blocks }, () => []),
    scheme: "ie9",
    detected,
});

describe("defaultLayoutMode", () => {
    it("opens a tagged compass animation as a rose", () => {
        expect(defaultLayoutMode({ mode: "compass", tiles: [] }, undefined)).toBe("rose");
    });

    /** The regression this exists for: eleven blocks, undetected, and it must still open as a rose. */
    it("opens an undetected multi-block character animation as a rose", () => {
        expect(defaultLayoutMode({ mode: "grid", tiles: [] }, analysis(11, false))).toBe("rose");
    });

    it("opens a detected multi-block animation as a rose", () => {
        expect(defaultLayoutMode({ mode: "grid", tiles: [] }, analysis(11, true))).toBe("rose");
    });

    /**
     * One block is a cycle list that merely happens to divide by a stride. Neither install has a
     * single-block animation that is a character or that the fingerprint detects, so a flat grid is what
     * it is, and reading it as one direction rose would be an invention.
     */
    it("keeps a single-block animation flat", () => {
        expect(defaultLayoutMode({ mode: "grid", tiles: [] }, analysis(1, false))).toBe("grid");
    });

    it("keeps an animation with no direction reading at all flat", () => {
        expect(defaultLayoutMode({ mode: "grid", tiles: [] }, undefined)).toBe("grid");
    });

    it("has nothing to go on before a view arrives", () => {
        expect(defaultLayoutMode(null, undefined)).toBe("grid");
    });
});
