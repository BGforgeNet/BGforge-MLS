import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTDSource } from "../src/td/dialog-source";
import { modelFromD, type DialogModel } from "../../shared/dialog-model";
import { applyTDDialogEdits } from "../../shared/dialog-td-edit";
import {
    addReply,
    addState,
    deleteState,
    removeReply,
    renameState,
    setChoiceTarget,
} from "../../shared/dialog-edit-ops";
import { computeDialogSourceEdit } from "../../client/src/dialog-editor/dialog-source-edit";

const botsmith = readFileSync(fileURLToPath(new URL("td/samples/botsmith.td", import.meta.url)), "utf8");

function tdModel(src: string): DialogModel {
    return { ...modelFromD(parseTDSource(src)), sourceLang: "td", editable: true };
}

/** The on-disk `.tra` set as the client loads it: every `@N` the file references, so allocation grows above. */
function existingFromModel(model: DialogModel): Record<string, string> {
    const out: Record<string, string> = {};
    for (const s of model.roots.flatMap((r) => r.states)) {
        for (const t of [s.text, ...s.choices.map((c) => c.text)]) {
            const m = /^@(\d+)$/.exec((t ?? "").trim());
            if (m) out[m[1]!] = `line ${m[1]}`;
        }
    }
    return out;
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

describe("TD remove-option via the LIVE two-parse path (regression for the live no-op)", () => {
    it("computeDialogSourceEdit removes an option when edited and original come from SEPARATE parses", () => {
        // The live editor parses the model once for the webview and re-parses `original` at applyEdit time -
        // two separate parses, NOT a structuredClone. This asserts the choice ids match across parses so the
        // writer's diff still finds the removed option (the unit test above uses one parse + clone, which hides
        // an id-instability bug).
        const original = tdModel(botsmith);
        const edited = tdModel(botsmith); // a SECOND independent parse
        const st = edited.roots.flatMap((r) => r.states).find((s) => s.id === "g_item_type")!;
        removeReply(st, st.choices[0]!.id);
        const { newText } = computeDialogSourceEdit(botsmith, edited, original);
        expect(newText, "a source edit should be produced").not.toBeNull();
        expect(newText).not.toContain("reply(tra(3))");
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

describe("applyTDDialogEdits - add option", () => {
    it("serializes a new reply(tra(N)); goTo(target); after the last surviving option, inside the function", () => {
        const original = tdModel(botsmith);
        const edited = structuredClone(original);
        const node = edited.roots.flatMap((r) => r.states).find((s) => s.id === "g_weapon")!;
        // A pending-new option (no source span, already @N-allocated) targeting g_armor.
        node.choices.push({ id: "g_weapon#new0", text: "@25", target: { kind: "state", stateId: "g_armor" } });
        const out = applyTDDialogEdits(botsmith, edited, original);
        const weaponBody = out.slice(out.indexOf("function g_weapon()"), out.indexOf("function g_armor()"));
        expect(weaponBody).toContain("reply(tra(25));");
        expect(weaponBody).toContain("goTo(g_armor);");
        // It lands after the existing options (which stay), still inside g_weapon's body.
        expect(weaponBody.indexOf("reply(tra(25))")).toBeGreaterThan(weaponBody.indexOf("reply(tra(6))"));
        expect(weaponBody).toContain("reply(tra(10));");
        // g_item_type is untouched (byte-identical outside g_weapon's body).
        const itemType = out.slice(out.indexOf("function g_item_type()"), out.indexOf("function g_weapon()"));
        expect(itemType).toBe(
            botsmith.slice(botsmith.indexOf("function g_item_type()"), botsmith.indexOf("function g_weapon()")),
        );
    });

    it("serializes a terminal exit() option", () => {
        const original = tdModel(botsmith);
        const edited = structuredClone(original);
        const node = edited.roots.flatMap((r) => r.states).find((s) => s.id === "g_armor")!;
        node.choices.push({ id: "g_armor#new0", text: "@26", target: { kind: "exit" } });
        const out = applyTDDialogEdits(botsmith, edited, original);
        const armorBody = out.slice(out.indexOf("function g_armor()"), out.indexOf("function g_trinket()"));
        expect(armorBody).toContain("reply(tra(26));");
        expect(armorBody).toContain("exit();");
    });
});

describe("applyTDDialogEdits - remove node", () => {
    it("splices the function, prunes the append list, and flips inbound goTo(deleted) to exit()", () => {
        const original = tdModel(botsmith);
        const edited = structuredClone(original);
        const gw = edited.roots.flatMap((r) => r.states).find((s) => s.id === "g_weapon")!;
        // deleteState: redirect inbound same-dialogue GOTOs to EXIT, then drop the state.
        deleteState(edited, gw);
        const out = applyTDDialogEdits(botsmith, edited, original);
        // The whole function is gone, body and all.
        expect(out).not.toContain("function g_weapon()");
        expect(out).not.toContain("say(tra(22))");
        // The append state list no longer names g_weapon.
        expect(out).toContain("append(dlg, [g_item_type, g_armor, g_trinket]);");
        // The inbound option in g_item_type keeps its reply but flips its target to exit() - no dangling goTo.
        const itemType = out.slice(out.indexOf("function g_item_type()"), out.indexOf("function g_armor()"));
        expect(itemType).toContain("reply(tra(3));");
        expect(itemType).toContain("exit();");
        expect(itemType).not.toContain("goTo(g_weapon)");
        // Unrelated nodes survive.
        expect(out).toContain("function g_armor()");
        expect(out).toContain("function g_trinket()");
    });
});

describe("applyTDDialogEdits - add node", () => {
    it("serializes a new function before the append statement and wires its id into the state list", () => {
        const original = tdModel(botsmith);
        const edited = structuredClone(original);
        const root = edited.roots.find((r) => r.kind === "dialog")!;
        // A brand-new node (no sourceRange) with an already-@N say and one terminal option.
        root.states.push({
            id: "g_shield",
            text: "@25",
            choices: [{ id: "g_shield#0", text: "@26", target: { kind: "exit" } }],
        });
        // Wire it in: retarget g_item_type's existing option from g_weapon to the new node.
        const opt = root.states
            .find((s) => s.id === "g_item_type")!
            .choices.find((c) => c.target.kind === "state" && c.target.stateId === "g_weapon")!;
        (opt.target as { kind: "state"; stateId: string }).stateId = "g_shield";
        const out = applyTDDialogEdits(botsmith, edited, original);
        // The new function is serialized with its say and terminal option, in statement form.
        expect(out).toMatch(
            /function g_shield\(\) \{\n {4}say\(tra\(25\)\);\n {4}reply\(tra\(26\)\);\n {4}exit\(\);\n\}/,
        );
        // It lands before the append statement (among the other state functions), after g_trinket.
        expect(out.indexOf("function g_shield()")).toBeGreaterThan(out.indexOf("function g_trinket()"));
        expect(out.indexOf("function g_shield()")).toBeLessThan(out.indexOf("append(dlg,"));
        // Its id is appended to the state list.
        expect(out).toContain("append(dlg, [g_item_type, g_weapon, g_armor, g_trinket, g_shield]);");
        // The inbound option is retargeted to it.
        const itemType = out.slice(out.indexOf("function g_item_type()"), out.indexOf("function g_weapon()"));
        expect(itemType).toContain("goTo(g_shield);");
        expect(itemType).not.toContain("goTo(g_weapon)");
    });
});

describe("applyTDDialogEdits - rename node", () => {
    it("rewrites the function name and its append-list entry; inbound goTo retargets; comments survive", () => {
        const original = tdModel(botsmith);
        const edited = structuredClone(original);
        const gw = edited.roots.flatMap((r) => r.states).find((s) => s.id === "g_weapon")!;
        // renameState records renamedFrom + moves inbound GOTO model choices to the new id.
        renameState(edited, gw, "g_blade");
        const out = applyTDDialogEdits(botsmith, edited, original);
        // Definition renamed in place (the surgical splice keeps the node's `// %cespenar_weapon%` comment).
        expect(out).toContain("function g_blade()");
        expect(out).not.toContain("function g_weapon()");
        expect(out).toContain("// %cespenar_weapon% transitions would be inserted here by TP2");
        // The append state list names the new id.
        expect(out).toContain("append(dlg, [g_item_type, g_blade, g_armor, g_trinket]);");
        // The inbound option in g_item_type retargets to the new id (moved by renameState, spliced by retarget).
        const itemType = out.slice(out.indexOf("function g_item_type()"), out.indexOf("function g_blade()"));
        expect(itemType).toContain("goTo(g_blade);");
        // No dangling reference to the old id anywhere (the comment mentions cespenar_weapon, not g_weapon).
        expect(out).not.toMatch(/\bg_weapon\b/);
    });

    it("rewrites an entry-block goTo target when the entry node is renamed", () => {
        const original = tdModel(botsmith);
        const edited = structuredClone(original);
        const git = edited.roots.flatMap((r) => r.states).find((s) => s.id === "g_item_type")!;
        renameState(edited, git, "g_menu");
        const out = applyTDDialogEdits(botsmith, edited, original);
        expect(out).toContain("function g_menu()");
        // The extendBottom entry block's goTo(g_item_type) is rewritten (it is not a model choice).
        expect(out).toContain("goTo(g_menu)");
        expect(out).not.toMatch(/\bg_item_type\b/);
        expect(out).toContain("append(dlg, [g_menu, g_weapon, g_armor, g_trinket]);");
    });
});

// End-to-end guard over the REAL webview save path: the model-edit ops build the edited model, then
// computeDialogSourceEdit runs D-family id allocation + the TD splice, and the produced source is re-parsed to
// confirm the change actually took effect and round-trips - not just that an intermediate helper returned data.
describe("TD structural editing - full computeDialogSourceEdit round-trip", () => {
    it("add-node authored with literal text mints tra ids, wires it in, and re-parses with the new content", () => {
        const original = tdModel(botsmith);
        original.messages = existingFromModel(original);
        const edited = tdModel(botsmith);
        edited.messages = { ...original.messages };
        // Author a new node the way the editor does: addState, type its say, add one option to an existing node
        // pointing at it, and give the new node a terminal reply.
        const root = edited.roots.find((r) => r.kind === "dialog")!;
        const node = addState(edited, root, "g_forge");
        node.text = "Forge something new?";
        const back = addReply(edited, node);
        back.text = "On second thought, no.";
        const menu = root.states.find((s) => s.id === "g_item_type")!;
        const opt = addReply(edited, menu);
        opt.text = "Show me the forge.";
        setChoiceTarget(menu, opt.id, { kind: "state", stateId: "g_forge" });

        const { newText, messages } = computeDialogSourceEdit(botsmith, edited, original);
        expect(newText).not.toBeNull();
        // Literal say/reply text was minted ascending ids in DOCUMENT order: g_item_type (earlier in the list)
        // and its new inbound option come before the appended g_forge, so the inbound reply takes 25.
        expect(messages["25"]).toBe("Show me the forge.");
        expect(messages["26"]).toBe("Forge something new?");
        expect(messages["27"]).toBe("On second thought, no.");

        // Re-parse the produced source: the new node exists, is wired into the append list, and the inbound
        // option and its reply landed - the change took effect and round-trips through the parser.
        const reparsed = modelFromD(parseTDSource(newText!));
        const forge = reparsed.roots.flatMap((r) => r.states).find((s) => s.id === "g_forge");
        expect(forge).toBeDefined();
        expect(forge!.text).toBe("@26");
        expect(newText).toContain("append(dlg, [g_item_type, g_weapon, g_armor, g_trinket, g_forge]);");
        const menu2 = reparsed.roots.flatMap((r) => r.states).find((s) => s.id === "g_item_type")!;
        const inbound = menu2.choices.find((c) => c.target.kind === "state" && c.target.stateId === "g_forge");
        expect(inbound).toBeDefined();
        expect(inbound!.text).toBe("@25");
    });
});
