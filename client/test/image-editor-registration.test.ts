import { describe, expect, test } from "vitest";
import pkg from "../../package.json";

describe("animation editor manifest", () => {
    test("registers a custom editor for .frm and .bam", () => {
        const editors = pkg.contributes.customEditors as {
            viewType: string;
            selector: { filenamePattern: string }[];
        }[];
        const anim = editors.find((e) => e.viewType === "bgforge.animationEditor");
        expect(anim).toBeDefined();
        const patterns = anim!.selector.map((s) => s.filenamePattern);
        expect(patterns).toEqual(expect.arrayContaining(["*.frm", "*.bam"]));
    });
    test("has the activation event", () => {
        expect(pkg.activationEvents).toContain("onCustomEditor:bgforge.animationEditor");
    });
});
