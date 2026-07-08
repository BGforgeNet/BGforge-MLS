import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTSSLSource } from "../src/tssl/dialog-source";
import { modelFromSSL, type DialogModel } from "../../shared/dialog-model";
import { applyTSSLDialogEdits } from "../../shared/dialog-tssl-edit";

const flat = readFileSync(fileURLToPath(new URL("tssl/samples/flat.tssl", import.meta.url)), "utf8");

function tsslModel(src: string): DialogModel {
    return { ...modelFromSSL(parseTSSLSource(src)), sourceLang: "tssl", editable: true };
}

describe("applyTSSLDialogEdits - option retarget", () => {
    it("splices an option's new target into the .tssl source, rest byte-identical", () => {
        const original = tsslModel(flat);
        const edited = structuredClone(original);
        const opt = edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices.find(
            (c) => c.target.kind === "state",
        )!;
        (opt.target as { kind: "state"; stateId: string }).stateId = "Node001";
        const out = applyTSSLDialogEdits(flat, edited, original);
        expect(out).toContain("NOption(101, Node001, 4)");
        expect(out).not.toContain("Node002, 4"); // the old target token is gone from that call
        // Everything outside the retargeted token is byte-identical.
        expect(out).toBe(flat.replace("NOption(101, Node002, 4)", "NOption(101, Node001, 4)"));
    });

    it("returns the source unchanged when no target changed", () => {
        const original = tsslModel(flat);
        expect(applyTSSLDialogEdits(flat, structuredClone(original), original)).toBe(flat);
    });

    it("splices an edited option condition into the .tssl if-wrapper", () => {
        const conditional = readFileSync(
            fileURLToPath(new URL("tssl/samples/conditional.tssl", import.meta.url)),
            "utf8",
        );
        const original = { ...modelFromSSL(parseTSSLSource(conditional)), sourceLang: "tssl" as const, editable: true };
        const edited = structuredClone(original);
        const opt = edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices.find(
            (c) => c.condition !== undefined,
        )!;
        opt.condition = "global_var(GVAR_Y) == 2";
        const out = applyTSSLDialogEdits(conditional, edited, original);
        expect(out).toContain("if (global_var(GVAR_Y) == 2)");
        expect(out).not.toContain("GVAR_X");
    });

    it("rejects a non-tssl model (each writer serializes only its own source syntax)", () => {
        const d = { ...tsslModel(flat), sourceLang: "d" as const };
        expect(() => applyTSSLDialogEdits(flat, d, tsslModel(flat))).toThrow(/only tssl/);
    });
});
