import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTDSource } from "../src/td/dialog-source";
import { modelFromD, type DialogModel } from "../../shared/dialog-model";
import { allocateDFamilyIds } from "../../shared/dialog-td-ids";
import { computeDialogSourceEdit } from "../../client/src/dialog-editor/dialog-source-edit";

const botsmith = readFileSync(fileURLToPath(new URL("td/samples/botsmith.td", import.meta.url)), "utf8");

function tdModel(src: string): DialogModel {
    return { ...modelFromD(parseTDSource(src)), sourceLang: "td", editable: true };
}

/**
 * The on-disk message set the way the real flow supplies it: the client loads the `.tra` and populates
 * `original.messages` with every `@N` the file references. A freshly-parsed model has empty `messages`, so
 * this reconstructs the equivalent map from the `@N` refs already in the model - the id space allocation must
 * grow above. botsmith's ids top out at 24, so the first free id is 25.
 */
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

describe("allocateDFamilyIds", () => {
    it("mints a fresh @N for a new option's literal text, above the existing max id", () => {
        const model = tdModel(botsmith);
        const state = model.roots.flatMap((r) => r.states).find((s) => s.id === "g_item_type")!;
        state.choices.push({ id: "g_item_type#new0", text: "Forge me a shield", target: { kind: "exit" } });
        const created = allocateDFamilyIds(model, existingFromModel(model));
        expect(created).toEqual({ "25": "Forge me a shield" });
        // The model's choice text is rewritten to the @N ref so the writer serializes tra(25).
        expect(state.choices.at(-1)!.text).toBe("@25");
    });

    it("mints ids for a new state's say text and its new option, in document order", () => {
        const model = tdModel(botsmith);
        const existing = existingFromModel(model);
        const root = model.roots.find((r) => r.kind === "dialog")!;
        root.states.push({
            id: "g_shield",
            text: "Shields are my specialty.",
            choices: [{ id: "g_shield#0", text: "Never mind", target: { kind: "exit" } }],
        });
        const created = allocateDFamilyIds(model, existing);
        expect(created).toEqual({ "25": "Shields are my specialty.", "26": "Never mind" });
        const s = root.states.find((st) => st.id === "g_shield")!;
        expect(s.text).toBe("@25");
        expect(s.choices[0]!.text).toBe("@26");
    });

    it("leaves an existing (@N, source-ranged) reply/say untouched and mints nothing on a clean model", () => {
        const model = tdModel(botsmith);
        const created = allocateDFamilyIds(model, existingFromModel(model));
        expect(created).toEqual({});
        // The existing say/reply refs keep their ids - allocation is a no-op for @N text.
        const state = model.roots.flatMap((r) => r.states).find((s) => s.id === "g_item_type")!;
        expect(state.text).toBe("@21");
        expect(state.choices[0]!.text).toBe("@3");
    });

    it("is idempotent: a second run mints nothing (the text is already @N)", () => {
        const model = tdModel(botsmith);
        const existing = existingFromModel(model);
        const root = model.roots.find((r) => r.kind === "dialog")!;
        root.states.push({ id: "g_new", text: "Brand new", choices: [] });
        const first = allocateDFamilyIds(model, existing);
        expect(first).toEqual({ "25": "Brand new" });
        const second = allocateDFamilyIds(model, { ...existing, ...first });
        expect(second).toEqual({});
    });

    it("skips a derived state (no source span but not authored here)", () => {
        const model = tdModel(botsmith);
        const root = model.roots.find((r) => r.kind === "dialog")!;
        root.states.push({ id: "g_derived", text: "Interjection", choices: [], derivedFrom: "CHAIN" });
        const created = allocateDFamilyIds(model, existingFromModel(model));
        expect(created).toEqual({});
    });
});

describe("computeDialogSourceEdit - td id allocation", () => {
    it("mints an @N for a new td option and merges it into the returned messages", () => {
        const original = tdModel(botsmith);
        original.messages = existingFromModel(original);
        const edited = structuredClone(original);
        const state = edited.roots.flatMap((r) => r.states).find((s) => s.id === "g_item_type")!;
        state.choices.push({ id: "g_item_type#new0", text: "Forge me a shield", target: { kind: "exit" } });
        const result = computeDialogSourceEdit(botsmith, edited, original);
        // The td branch ran the D-family allocator: the new literal got id 25 and rode out in messages.
        expect(result.messages["25"]).toBe("Forge me a shield");
        expect(state.choices.at(-1)!.text).toBe("@25");
    });

    it("does not report an existing @N td option as a pending allocation (its source span keys it committed)", () => {
        const original = tdModel(botsmith);
        original.messages = existingFromModel(original);
        const edited = structuredClone(original);
        // Retarget an existing transition so a splice happens (newText != null); the allocations map must then
        // exclude the file's existing @N options - each carries a sourceRange, so it is not a pending new item.
        const choice = edited.roots
            .flatMap((r) => r.states)
            .find((s) => s.id === "g_item_type")!
            .choices.find((c) => c.target.kind === "state" && c.target.stateId === "g_weapon")!;
        (choice.target as { kind: "state"; stateId: string }).stateId = "g_armor";
        const result = computeDialogSourceEdit(botsmith, edited, original);
        expect(result.newText).not.toBeNull();
        expect(result.allocations).toEqual({});
    });
});
