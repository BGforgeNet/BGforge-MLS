import { describe, expect, test } from "vitest";
import { DEFAULT_FALLOUT_PALETTE } from "@bgforge/image";
import { chooseActivePalette, sidecarPalPath } from "../../src/image-editor/sidecar";

test("sidecarPalPath swaps the extension for .pal", () => {
    expect(sidecarPalPath("/a/b/hero.frm")).toBe("/a/b/hero.pal");
    expect(sidecarPalPath("/a/b/hero.FRM")).toBe("/a/b/hero.pal");
});

describe("chooseActivePalette", () => {
    const sidecar = Array.from({ length: 256 }, () => ({ r: 1, g: 2, b: 3, a: 255 }));
    const embedded = Array.from({ length: 256 }, () => ({ r: 9, g: 9, b: 9, a: 255 }));
    test("BAM always uses the embedded palette", () => {
        expect(chooseActivePalette({ sourceFormat: "bam", embedded, sidecar, externalEnabled: true })).toBe(embedded);
    });
    test("FRM uses the sidecar only when enabled and present", () => {
        expect(chooseActivePalette({ sourceFormat: "frm", embedded, sidecar, externalEnabled: true })).toBe(sidecar);
        expect(chooseActivePalette({ sourceFormat: "frm", embedded, sidecar, externalEnabled: false })).toBe(
            DEFAULT_FALLOUT_PALETTE,
        );
        expect(chooseActivePalette({ sourceFormat: "frm", embedded, externalEnabled: true })).toBe(
            DEFAULT_FALLOUT_PALETTE,
        );
    });
});
