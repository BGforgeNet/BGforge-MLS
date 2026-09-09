/**
 * The single FILE editor's "Save as" menu. A set does not use this - it opens a dialog whose controls are
 * radios over the geometry and naming axes, covered by `conversion.test.ts` and `set-provider.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { buildSaveAsOptions } from "../../src/image-editor/webview/save-as-options";

function values(options: ReturnType<typeof buildSaveAsOptions>): string[] {
    return options.map((option) => option.value);
}

describe("buildSaveAsOptions", () => {
    /** Plain Save already writes the source's own format in place, so offering it again means nothing. */
    it("leaves out the source's own format", () => {
        expect(values(buildSaveAsOptions("bam"))).not.toContain("bam");
        expect(values(buildSaveAsOptions("bamc"))).not.toContain("bamc");
        expect(values(buildSaveAsOptions("bamv2"))).not.toContain("bamv2");
    });

    it("leaves out both palette modes when the source is already an FRM", () => {
        expect(values(buildSaveAsOptions("frm"))).toEqual(["bam", "bamc", "bamv2", "apng", "png-directory"]);
    });

    it("offers every target when nothing is loaded", () => {
        expect(values(buildSaveAsOptions(null))).toEqual([
            "frm-sidecar",
            "frm-nearest",
            "bam",
            "bamc",
            "bamv2",
            "apng",
            "png-directory",
        ]);
    });

    /** FRM is the one target with a choice to make, and it is made by picking one of the two entries. */
    it("carries the palette mode on the FRM entries and on nothing else", () => {
        const options = buildSaveAsOptions("bam");

        expect(options.find((option) => option.value === "frm-sidecar")?.paletteMode).toBe("sidecar");
        expect(options.find((option) => option.value === "frm-nearest")?.paletteMode).toBe("nearest");
        expect(options.filter((option) => option.paletteMode !== undefined)).toHaveLength(2);
    });

    /** The value is the menu's own key; the TARGET is what the host writes, so each names a real one. */
    it("names a real save target for every entry", () => {
        expect(buildSaveAsOptions(null).map((option) => option.target)).toEqual([
            "frm",
            "frm",
            "bam",
            "bamc",
            "bamv2",
            "apng",
            "png-directory",
        ]);
    });
});
