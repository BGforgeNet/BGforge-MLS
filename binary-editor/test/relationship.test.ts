import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectRow } from "../src/window";
import type { RelationshipModel } from "../src/relationship/types";
import { ieEffectsModel, ieEffectsFieldOverride, ieEffectsDependents } from "../src/relationship/ie-effects";
import { getRelationshipModel } from "../src/relationship/registry";
import { normKey } from "../src/relationship/model-helpers";
import { openSession, sessionStore } from "../src/session";
import type { FlatNode, Model } from "../src/model";
import { openItmSession, firstEffectFields, setRaw, itmFixturePresent } from "./ie-fixture";

// The EFF v2 body has fields the shared 48-byte feature block lacks, so those cases need a standalone EFF.
// It lives in the reproducible-but-gitignored external corpus, hence the per-test presence guard.
const EFF_FIXTURE = path.resolve(
    __dirname,
    "../../external/infinity-engine/Ascension/ascension/balthazar/resource/balth01b.eff",
);

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

/**
 * The IDS-Entry / IDS-File opcodes: parameter1 is an entry in a table parameter2 names, so no static ref can
 * be declared on the spec - only the overlay sees the sibling. It emits a computed `ids` ref instead, which
 * the host resolves through the same path as a declared one.
 */
describe("ieEffectsModel.fieldOverride IDS-file-dependent entry (real ITM display tree)", () => {
    it("computes parameter1's table from parameter2's current value", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 55); // Death: Kill Creature Type - param1 entry, param2 file
        setRaw(f.get("parameter2")!, 4); // op55 slot 4 = RACE.IDS
        expect(ieEffectsModel.fieldOverride(session.model, f.get("parameter1")!)?.ref).toEqual({
            kind: "ids",
            tables: ["RACE"],
        });
    });

    // The whole point of computing it: the same field resolves against a different table when the sibling moves.
    it("follows parameter2 to a different table", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 55);
        setRaw(f.get("parameter2")!, 5); // slot 5 = CLASS.IDS
        expect(ieEffectsModel.fieldOverride(session.model, f.get("parameter1")!)?.ref).toEqual({
            kind: "ids",
            tables: ["CLASS"],
        });
    });

    // The mapping is per opcode, not shared: op72 is 0-based where op55 is 2-based, so the SAME stored
    // parameter2 names a different table under each.
    it("uses the opcode's own mapping, not a shared one", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("parameter2")!, 4);
        setRaw(f.get("opcode")!, 55);
        expect(ieEffectsModel.fieldOverride(session.model, f.get("parameter1")!)?.ref).toMatchObject({
            tables: ["RACE"],
        });
        setRaw(f.get("opcode")!, 72);
        expect(ieEffectsModel.fieldOverride(session.model, f.get("parameter1")!)?.ref).toMatchObject({
            tables: ["SPECIFIC"],
        });
    });

    // Editions ship the same table under either name, so the candidate list carries both and the install picks.
    it("offers both spellings of the alignment table", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 55);
        setRaw(f.get("parameter2")!, 8);
        expect(ieEffectsModel.fieldOverride(session.model, f.get("parameter1")!)?.ref).toEqual({
            kind: "ids",
            tables: ["ALIGN", "ALIGNMEN"],
        });
    });

    // Never guess a table: a value the opcode does not map leaves the field the plain number it was.
    it("emits no ref for a parameter2 value the opcode does not map", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 55);
        setRaw(f.get("parameter2")!, 99);
        expect(ieEffectsModel.fieldOverride(session.model, f.get("parameter1")!)?.ref).toBeUndefined();
    });

    it("names the files on parameter2 so the selector is not a bare number", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 55);
        const p2 = ieEffectsModel.fieldOverride(session.model, f.get("parameter2")!);
        expect(p2?.presentationType).toBe("enum");
        expect(p2?.enumOptions).toMatchObject({ "2": "EA.IDS", "4": "RACE.IDS", "9": "KIT.IDS" });
    });

    // A derived dropdown has to re-project on EVERY path that can change it - here the sibling, not the opcode.
    it("re-resolves parameter1 when parameter2 changes on an IDS-file opcode", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 55);
        const deps = ieEffectsModel.dependents(session.model, f.get("parameter2")!);
        expect(deps).toContain(f.get("parameter1")!.id);
    });

    // ...and not on an opcode where parameter2 means something else, so an ordinary edit stays local.
    it("does not re-resolve parameter1 on a parameter2 edit for a plain opcode", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 1);
        const deps = ieEffectsModel.dependents(session.model, f.get("parameter2")!);
        expect(deps).not.toContain(f.get("parameter1")!.id);
    });
});

/**
 * The effect's own resref: what it points at is a function of the opcode, so the spec defers it and the
 * overlay supplies the type from the opcode's own IESDP page. Only opcodes whose pages agree on ONE target
 * get a ref - resolving against the wrong namespace is worse than leaving the field unresolved.
 */
describe("ieEffectsModel.fieldOverride opcode-typed resource (real ITM display tree)", () => {
    const refFor = (opcode: number) => {
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, opcode);
        return ieEffectsModel.fieldOverride(session.model, f.get("resource")!)?.ref;
    };

    // One per target type, so a table-wide mistake cannot hide behind a single passing case.
    it.each([
        [67, "CRE"], // Summon: Creature Summoning
        [111, "ITM"], // Item: Create Magical Weapon
        [146, "SPL"], // Spell: Cast Spell (at Creature)
        [174, "WAV"], // Spell Effect: Play Sound Effect
        [177, "EFF"], // Use EFF File
        [214, "2DA"], // Spell Effect: Select Spell
    ])("types the resource of opcode %i as %s", (opcode, type) => {
        if (!itmFixturePresent()) return;
        expect(refFor(opcode)).toEqual({ kind: "resource", type });
    });

    // The same field, two opcodes, two namespaces - which is why this cannot be declared on the spec.
    it("retypes the same field when the opcode changes", () => {
        if (!itmFixturePresent()) return;
        expect(refFor(146)).toEqual({ kind: "resource", type: "SPL" });
        expect(refFor(122)).toEqual({ kind: "resource", type: "ITM" });
    });

    // Two IESDP pages name two different targets for opcode 215 ("the BAM/VVC"), so it stays unresolved
    // rather than picking one; an unknown opcode likewise.
    it.each([215, 321, 65000])("leaves the resource unresolved for opcode %i", (opcode) => {
        if (!itmFixturePresent()) return;
        expect(refFor(opcode)).toBeUndefined();
    });

    it("re-resolves the resource when the opcode changes", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        expect(ieEffectsModel.dependents(session.model, f.get("opcode")!)).toContain(f.get("resource")!.id);
    });
});

/**
 * The dword the spec calls a TobEx stacking id, and the power byte: 36 opcodes and one respectively give them
 * a meaning of their own, which the overlay surfaces the same way it relabels the parameters.
 */
describe("ieEffectsModel.fieldOverride opcode-named special and power (real ITM display tree)", () => {
    it("names the stacking-id dword what the opcode reads it as", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 39); // State: Unconsciousness - its page labels this field "Icon"
        expect(ieEffectsModel.fieldOverride(session.model, f.get("stackingidex")!)?.label).toBe("Icon");
    });

    it("leaves the static stacking-id label for an opcode that does not read it", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 1);
        expect(ieEffectsModel.fieldOverride(session.model, f.get("stackingidex")!)).toBeUndefined();
    });

    it("names the power byte for the one opcode that gives it a meaning", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        setRaw(f.get("opcode")!, 319); // Usability: Item Usability
        expect(ieEffectsModel.fieldOverride(session.model, f.get("power")!)?.label).toBe("Usability behavior");
    });

    it("re-resolves both when the opcode changes", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        const deps = ieEffectsModel.dependents(session.model, f.get("opcode")!);
        expect(deps).toEqual(expect.arrayContaining([f.get("stackingidex")!.id, f.get("power")!.id]));
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

/**
 * The EFF v2 body carries fields the 48-byte feature block does not - the EE-era parameter3..5, and the parent
 * resource pair - so these run against a real standalone EFF rather than the ITM fixture.
 */
describe("ieEffectsModel.fieldOverride EFF v2 body fields (real EFF display tree)", () => {
    let counter = 0;
    /** A fresh session per call, since each test drives the record's fields to its own values. */
    const openEff = (): { model: Model; f: Map<string, FlatNode> } => {
        const bytes = new Uint8Array(fs.readFileSync(EFF_FIXTURE));
        const { sessionId } = openSession(`file:///fixture${counter++}.eff`, bytes);
        const session = sessionStore.get(sessionId);
        if (!session) throw new Error("EFF fixture did not open");
        const f = new Map<string, FlatNode>();
        for (const n of session.model.nodes) if (n.kind === "field") f.set(normKey(n.name), n);
        return { model: session.model, f };
    };

    // The parent resource is the one effect resref that is NOT opcode-dependent: its sibling type field names
    // it. Across BG:EE, BG2:ToB and the mod corpus, every record holding one also carries a non-zero type.
    it.each([
        [1, "SPL"],
        [2, "ITM"],
    ])("types the parent resource from parentResourceType %i as %s", (kind, type) => {
        if (!fs.existsSync(EFF_FIXTURE)) return;
        const { model, f } = openEff();
        setRaw(f.get("parentresourcetype")!, kind);
        expect(ieEffectsModel.fieldOverride(model, f.get("parentresource")!)?.ref).toEqual({
            kind: "resource",
            type,
        });
    });

    // Type 0 is "None" - there is no parent, so there is nothing to point the resref at.
    it("leaves the parent resource unresolved when its type says None", () => {
        if (!fs.existsSync(EFF_FIXTURE)) return;
        const { model, f } = openEff();
        setRaw(f.get("parentresourcetype")!, 0);
        expect(ieEffectsModel.fieldOverride(model, f.get("parentresource")!)?.ref).toBeUndefined();
    });

    it("re-resolves the parent resource when its type changes", () => {
        if (!fs.existsSync(EFF_FIXTURE)) return;
        const { model, f } = openEff();
        expect(ieEffectsModel.dependents(model, f.get("parentresourcetype")!)).toContain(f.get("parentresource")!.id);
    });

    // The EE-era slots. IESDP documents these on the engine-variant pages only, which is why they reach the
    // editor at all now - a canonical-page-only harvest never saw them.
    it("labels parameter3 and parameter4 for an opcode whose page names them", () => {
        if (!fs.existsSync(EFF_FIXTURE)) return;
        const { model, f } = openEff();
        setRaw(f.get("opcode")!, 272); // Spell: Apply Repeating EFF
        expect(ieEffectsModel.fieldOverride(model, f.get("parameter3")!)?.label).toBe("Amount_2");
        expect(ieEffectsModel.fieldOverride(model, f.get("parameter4")!)?.label).toBe("Frequency Multiplier");
    });

    it("leaves parameter3 unlabelled for an opcode that does not read it", () => {
        if (!fs.existsSync(EFF_FIXTURE)) return;
        const { model, f } = openEff();
        setRaw(f.get("opcode")!, 1); // Stat: Attacks Per Round Modifier - two parameters, no more
        expect(ieEffectsModel.fieldOverride(model, f.get("parameter3")!)).toBeUndefined();
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
        cascade: () => [],
    };
    const enumModel: RelationshipModel = {
        formatId: "itm",
        fieldOverride: (_m, node) =>
            /parameter2/i.test(node.name)
                ? { presentationType: "enum", enumOptions: { "0": "A", "1": "B" } }
                : undefined,
        dependents: () => [],
        constraints: () => [],
        cascade: () => [],
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
