import { describe, it, expect } from "vitest";
import pkg from "../../package.json";

describe("dialog editor manifest", () => {
    it("registers the dialog custom editor as an opt-in option for every dialog source language", () => {
        const editors = (pkg.contributes.customEditors ?? []) as Array<{
            viewType: string;
            priority?: string;
            selector: Array<{ filenamePattern: string }>;
        }>;
        const dialog = editors.find((e) => e.viewType === "bgforge.dialogEditor");
        expect(dialog, "bgforge.dialogEditor custom editor").toBeDefined();
        expect(dialog!.priority).toBe("option");
        const patterns = dialog!.selector.map((s) => s.filenamePattern).sort();
        // The two runtime dialog formats (.d/.ssl) plus their transpiler source languages (.td/.tssl),
        // all editable in the dialog graph.
        expect(patterns).toEqual(["*.d", "*.ssl", "*.td", "*.tssl"]);
    });
});
