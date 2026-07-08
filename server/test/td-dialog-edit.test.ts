import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTDSource } from "../src/td/dialog-source";
import { modelFromD, type DialogModel } from "../../shared/dialog-model";
import { applyTDDialogEdits } from "../../shared/dialog-td-edit";

const botsmith = readFileSync(fileURLToPath(new URL("td/samples/botsmith.td", import.meta.url)), "utf8");

function tdModel(src: string): DialogModel {
    return { ...modelFromD(parseTDSource(src)), sourceLang: "td", editable: true };
}

describe("applyTDDialogEdits - transition retarget", () => {
    it("splices a goTo target's new id into the .td source, rest byte-identical", () => {
        const original = tdModel(botsmith);
        const edited = structuredClone(original);
        const choice = edited.roots
            .flatMap((r) => r.states)
            .find((s) => s.id === "g_item_type")!
            .choices.find((c) => c.target.kind === "state" && c.target.stateId === "g_weapon")!;
        (choice.target as { kind: "state"; stateId: string }).stateId = "g_armor";
        const out = applyTDDialogEdits(botsmith, edited, original);
        // Only the target token is rewritten: `goTo(g_weapon)` -> `goTo(g_armor)`; the `function g_weapon()`
        // definition and everything else are byte-identical.
        expect(out).toBe(botsmith.replace("goTo(g_weapon)", "goTo(g_armor)"));
        expect(out).toContain("function g_weapon()");
    });

    it("returns the source unchanged when no target changed", () => {
        const original = tdModel(botsmith);
        expect(applyTDDialogEdits(botsmith, structuredClone(original), original)).toBe(botsmith);
    });

    it("rejects a non-td model", () => {
        const ssl = { ...tdModel(botsmith), sourceLang: "ssl" as const };
        expect(() => applyTDDialogEdits(botsmith, ssl, tdModel(botsmith))).toThrow(/only td/);
    });
});
