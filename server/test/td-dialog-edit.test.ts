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

describe("applyTDDialogEdits - remove option", () => {
    it("splices a removed transition's whole reply+goTo statement out; siblings and the target node stay", () => {
        const original = tdModel(botsmith);
        const edited = structuredClone(original);
        const node = edited.roots.flatMap((r) => r.states).find((s) => s.id === "g_item_type")!;
        // Drop the first player option (reply @3 -> g_weapon).
        node.choices = node.choices.filter((c) => !(c.target.kind === "state" && c.target.stateId === "g_weapon"));
        const out = applyTDDialogEdits(botsmith, edited, original);
        // The whole reply+goTo statement group is gone.
        expect(out).not.toContain("reply(tra(3))");
        expect(out).not.toContain("goTo(g_weapon)");
        // Its siblings survive verbatim, the say line and node wrapper stay, and the target node is untouched
        // (only the transition TO it was removed).
        expect(out).toContain("reply(tra(4));");
        expect(out).toContain("goTo(g_armor);");
        expect(out).toContain("say(tra(21));");
        expect(out).toContain("function g_item_type()");
        expect(out).toContain("function g_weapon()");
    });

    it("removes only the last option, leaving the say and earlier options intact", () => {
        const original = tdModel(botsmith);
        const edited = structuredClone(original);
        const node = edited.roots.flatMap((r) => r.states).find((s) => s.id === "g_weapon")!;
        // g_weapon: reply @10 -> g_item_type, reply @6 -> startState. Drop the last.
        node.choices = node.choices.filter((c) => !(c.target.kind === "state" && c.target.stateId === "startState"));
        const out = applyTDDialogEdits(botsmith, edited, original);
        const weaponBody = out.slice(out.indexOf("function g_weapon()"), out.indexOf("function g_armor()"));
        expect(weaponBody).toContain("reply(tra(10));");
        expect(weaponBody).not.toContain("reply(tra(6));");
        expect(weaponBody).toContain("say(tra(22));");
    });
});
