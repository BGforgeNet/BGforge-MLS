import { describe, expect, it } from "vitest";
import { projectRow } from "../src/window";
import type { RelationshipModel } from "../src/relationship/types";
import { ieEffectsModel, ieEffectsFieldOverride, ieEffectsDependents } from "../src/relationship/ie-effects";
import { getRelationshipModel } from "../src/relationship/registry";
import { openItmSession, firstEffectFields, setRaw, itmFixturePresent } from "./ie-fixture";

// These tests run the IE relationship model against the REAL display tree produced
// by the parser (humanized labels "Opcode"/"Parameter1", enum codes in rawValue),
// driving the first effect to a chosen opcode for controlled assertions.

describe("ieEffectsModel.fieldOverride (real ITM display tree)", () => {
    it("relabels parameter1/parameter2 from IESDP data for a known opcode", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 1); // opcode 1 = Stat: Attacks Per Round Modifier
        expect(ieEffectsModel.fieldOverride(session.model, f.get("parameter1")!)?.label).toBe("Key Modifier");
        const p2 = ieEffectsModel.fieldOverride(session.model, f.get("parameter2")!);
        expect(p2?.label).toBe("Type");
        expect(p2?.presentationType).toBe("enum");
        expect(p2?.enumOptions?.["0"]).toBe("Cumulative Modifier");
    });
    it("adds an engine-availability description to the opcode field", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 1);
        expect(ieEffectsModel.fieldOverride(session.model, f.get("opcode")!)?.description).toMatch(/BG1|BG2|engine/i);
    });
    it("produces no override for an unknown/modded opcode", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 65000);
        expect(ieEffectsModel.fieldOverride(session.model, f.get("parameter1")!)).toBeUndefined();
    });
});

describe("ieEffectsModel.fieldOverride dual-purpose dice/level field (real ITM display tree)", () => {
    // The 0x1c/0x20 dword pair is dual-purpose: Maximum/Minimum Level for most opcodes, but Dice Thrown/Dice
    // Sides for opcodes 12/17/18/331/333 and 218 (only when parameter2=1). The static label is the level
    // reading; the overlay flips it to the dice reading for exactly those opcodes.
    for (const op of [12, 17, 18, 331, 333]) {
        it(`relabels the field pair Dice Thrown/Dice Sides for dice opcode ${op}`, () => {
            if (!itmFixturePresent()) return;
            const session = openItmSession();
            const f = firstEffectFields(session.model);
            setRaw(f.get("opcode")!, op);
            expect(ieEffectsModel.fieldOverride(session.model, f.get("maxlevel")!)?.label).toBe("Dice Thrown");
            expect(ieEffectsModel.fieldOverride(session.model, f.get("minlevel")!)?.label).toBe("Dice Sides");
        });
    }
    it("leaves the static Maximum/Minimum Level label (no override) for a non-dice opcode", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 1); // stat modifier - reads the field pair as the level range
        expect(ieEffectsModel.fieldOverride(session.model, f.get("maxlevel")!)).toBeUndefined();
        expect(ieEffectsModel.fieldOverride(session.model, f.get("minlevel")!)).toBeUndefined();
    });
    it("opcode 218 reads dice only when parameter2 = 1", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 218);
        setRaw(f.get("parameter2")!, 0);
        expect(ieEffectsModel.fieldOverride(session.model, f.get("maxlevel")!)).toBeUndefined();
        setRaw(f.get("parameter2")!, 1);
        expect(ieEffectsModel.fieldOverride(session.model, f.get("maxlevel")!)?.label).toBe("Dice Thrown");
    });
    it("re-resolves the level/dice fields when the opcode or parameter2 changes", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        const ids = [f.get("maxlevel")!.id, f.get("minlevel")!.id];
        expect(ieEffectsModel.dependents(session.model, f.get("opcode")!)).toEqual(expect.arrayContaining(ids));
        expect(ieEffectsModel.dependents(session.model, f.get("parameter2")!)).toEqual(expect.arrayContaining(ids));
    });
});

describe("ieEffectsModel.constraints (real ITM display tree)", () => {
    it("flags an empty probability range with a swap quick-fix", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        const p1 = f.get("probability1")!;
        const p2 = f.get("probability2")!;
        setRaw(p1, 10); // upper < lower => empty range
        setRaw(p2, 40);
        const d = ieEffectsModel.constraints(session.model).find((x) => x.nodeId === p1.id);
        expect(d?.severity).toBe("warning");
        expect(d?.quickFix?.edits).toEqual([
            { nodeId: p1.id, value: 40 },
            { nodeId: p2.id, value: 10 },
        ]);
    });
    it("no diagnostic targets a probability range that is valid", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        const p1 = f.get("probability1")!;
        setRaw(p1, 100);
        setRaw(f.get("probability2")!, 0);
        expect(ieEffectsModel.constraints(session.model).some((x) => x.nodeId === p1.id)).toBe(false);
    });
});

describe("projectRow overlay mechanism", () => {
    const labelModel: RelationshipModel = {
        formatId: "itm",
        fieldOverride: (_m, node) => (/parameter2/i.test(node.name) ? { label: "Type" } : undefined),
        dependents: () => [],
        constraints: () => [],
    };
    const enumModel: RelationshipModel = {
        formatId: "itm",
        fieldOverride: (_m, node) =>
            /parameter2/i.test(node.name)
                ? { presentationType: "enum", enumOptions: { "0": "A", "1": "B" } }
                : undefined,
        dependents: () => [],
        constraints: () => [],
    };
    it("applies a returned fieldOverride label to the row name", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const p2 = firstEffectFields(session.model).get("parameter2")!;
        expect(projectRow(session.model, p2, labelModel).name).toBe("Type");
    });
    it("is unchanged when no model is passed", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const p2 = firstEffectFields(session.model).get("parameter2")!;
        expect(projectRow(session.model, p2).name).toBe(p2.name);
    });
    it("re-types a numeric field to enum so the view renders a dropdown", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const p2 = firstEffectFields(session.model).get("parameter2")!;
        const row = projectRow(session.model, p2, enumModel);
        // controlKind() in the view keys the dropdown off valueType === "enum" plus enumOptions.
        expect(row.valueType).toBe("enum");
        expect(row.enumOptions).toEqual({ "0": "A", "1": "B" });
    });
});

describe("IE relationship model parity across formats", () => {
    it("shares the IE field overlay across itm/spl/eff (constraints differ per format)", () => {
        // itm/spl/eff carry only slice relationships (no index dropdown), so they use the shared overlay
        // object verbatim. CRE composes a named-item slot dropdown on top, so its fieldOverride differs (see
        // the cre case below); all four still share dependents and compose their own per-format constraints.
        for (const fmt of ["itm", "spl", "eff"]) {
            const model = getRelationshipModel(fmt);
            expect(model, fmt).toBeDefined();
            expect(model!.fieldOverride).toBe(ieEffectsFieldOverride);
            expect(model!.dependents).toBe(ieEffectsDependents);
        }
    });
    it("cre composes a named-item slot overlay + dependents over the shared IE behavior", () => {
        const model = getRelationshipModel("cre");
        expect(model).toBeDefined();
        // The item-slot dropdown overlay wraps - not replaces - the IE overlay (slot labels) and its
        // dependents (re-project slots when an item ResRef changes), so both objects differ from the shared
        // ones while still delegating to them for non-slot fields.
        expect(model!.fieldOverride).not.toBe(ieEffectsFieldOverride);
        expect(model!.dependents).not.toBe(ieEffectsDependents);
    });
    it("overlays params on a real (shared IE effect) display tree", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 1);
        expect(ieEffectsModel.fieldOverride(session.model, f.get("parameter1")!)?.label).toBe("Key Modifier");
    });
});
