import { describe, it, expect } from "vitest";
import pkg from "../../package.json";

describe("dialog editor manifest", () => {
    it("registers the dialog custom editor as an opt-in option for .d and .ssl", () => {
        const editors = (pkg.contributes.customEditors ?? []) as Array<{
            viewType: string;
            priority?: string;
            selector: Array<{ filenamePattern: string }>;
        }>;
        const dialog = editors.find((e) => e.viewType === "bgforge.dialogEditor");
        expect(dialog, "bgforge.dialogEditor custom editor").toBeDefined();
        expect(dialog!.priority).toBe("option");
        const patterns = dialog!.selector.map((s) => s.filenamePattern).sort();
        // Slice 1: D and SSL only. Slice 2 adds *.td and *.tssl.
        expect(patterns).toEqual(["*.d", "*.ssl"]);
    });
});
