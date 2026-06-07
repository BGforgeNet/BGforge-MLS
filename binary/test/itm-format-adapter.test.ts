import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatAdapterRegistry } from "../src/format-adapter";
import { itmParser } from "../src/itm";
import { getItmCanonicalDocument, rebuildItmCanonicalDocument } from "../src/itm/canonical-reader";
import { serializeItmCanonicalDocument } from "../src/itm/canonical-writer";
import {
    defaultItmAbility,
    defaultItmEffect,
    isItmAddableArray,
    isItmListSection,
    isItmModifiableArray,
} from "../src/itm/entity-ops";
import type { ParseResult } from "../src/types";

const itm = formatAdapterRegistry.get("itm")!;

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/bg2-wildmage/wildmage/wild_spells/itm/wm_sbook.itm");
const hasFixture = fs.existsSync(FIXTURE);

/**
 * Build a synthetic 2-ability ITM where ability0 owns effect[0] and ability1
 * owns effects[1,2]. This is the shape the entity-ops tests use (see
 * makeTwoAbilityBase there): the real single-ability/single-effect fixture has
 * a degenerate partition (its lone effect is equipping-owned) that some effect
 * ops legitimately decline. This base lets the adapter-routing smoke tests
 * exercise every op end-to-end with bytes that actually come back.
 */
function makeTwoAbilityBase(): ParseResult {
    const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
    if (parsed.errors) throw new Error(parsed.errors.join(", "));
    const doc = getItmCanonicalDocument(parsed) ?? rebuildItmCanonicalDocument(parsed);
    if (!doc) throw new Error("no canonical doc");

    const effect = (opcode: number) => ({ ...defaultItmEffect(), opcode });
    const base = {
        ...doc,
        header: { ...doc.header, featureBlocksIndex: 0, featureBlocksCount: 0 },
        abilities: [
            { ...defaultItmAbility(), featureBlockIndex: 0, featureBlockCount: 1 },
            { ...defaultItmAbility(), featureBlockIndex: 1, featureBlockCount: 2 },
        ],
        effects: [effect(10), effect(20), effect(21)],
    };

    const reparsed = itmParser.parse(serializeItmCanonicalDocument(base));
    if (reparsed.errors) throw new Error(`base reparse errors: ${reparsed.errors.join(", ")}`);
    return reparsed;
}

describe("itm adapter structure-op surface", () => {
    it("classifies Abilities and Effects as modifiable list sections", () => {
        expect(isItmListSection(["Abilities"])).toBe(true);
        expect(isItmListSection(["Effects"])).toBe(true);
        expect(isItmListSection(["ITM Header"])).toBe(false);
        expect(isItmModifiableArray(["Abilities"])).toBe(true);
        expect(isItmModifiableArray(["Effects"])).toBe(true);
    });

    it("offers add only on Abilities (Effects add is gated off)", () => {
        expect(isItmAddableArray(["Abilities"])).toBe(true);
        expect(isItmAddableArray(["Effects"])).toBe(false);
    });

    it("recognizes ability and effect entry paths as removable", () => {
        expect(itm.isRemovableEntry!(["Abilities", "Ability 1"])).toBe(true);
        expect(itm.isRemovableEntry!(["Effects", "Effect 1"])).toBe(true);
        expect(itm.isRemovableEntry!(["ITM Header", "Signature"])).toBe(false);
    });

    it("rejects non-list-section paths for all predicates", () => {
        expect(isItmListSection(["ITM File"])).toBe(false);
        expect(isItmModifiableArray(["ITM File"])).toBe(false);
        expect(isItmAddableArray(["ITM File"])).toBe(false);
        expect(itm.isRemovableEntry!(["ITM File", "Abilities"])).toBe(false);
    });

    it("buildAddEntryBytes returns bytes for Abilities and undefined for Effects", () => {
        if (!hasFixture) return;
        const pr = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        expect(pr.errors).toBeUndefined();
        const abilityBytes = itm.buildAddEntryBytes!(pr, ["Abilities"]);
        expect(abilityBytes).toBeInstanceOf(Uint8Array);
        expect((abilityBytes as Uint8Array).byteLength).toBeGreaterThan(0);
        const effectBytes = itm.buildAddEntryBytes!(pr, ["Effects"]);
        expect(effectBytes).toBeUndefined();
    });

    // End-to-end routing smoke tests: prove the adapter delegates Abilities->ability builders and
    // Effects->effect builders for every op (not just at the predicate layer). Bytes that come back
    // are reparsed to confirm the routed builder produced a valid ITM. Builder-internals are covered
    // in itm-entity-ops.test.ts; these stay tight.
    it("routes ability ops end-to-end and produces reparseable bytes", () => {
        if (!hasFixture) return;
        const pr = makeTwoAbilityBase();

        const removeBytes = itm.buildRemoveEntryBytes!(pr, ["Abilities"], 0);
        expect(removeBytes).toBeInstanceOf(Uint8Array);
        expect(itmParser.parse(removeBytes as Uint8Array).errors).toBeUndefined();

        const insertBytes = itm.buildInsertEntryBytes!(pr, ["Abilities"], 0, "after");
        expect(insertBytes).toBeInstanceOf(Uint8Array);
        expect(itmParser.parse(insertBytes as Uint8Array).errors).toBeUndefined();

        const duplicateBytes = itm.buildDuplicateEntryBytes!(pr, ["Abilities"], 0);
        expect(duplicateBytes).toBeInstanceOf(Uint8Array);
        expect(itmParser.parse(duplicateBytes as Uint8Array).errors).toBeUndefined();

        // Two abilities, so moving index 0 down swaps with index 1 and yields bytes (not a boundary
        // no-op). The contract stays bytes-or-undefined; when bytes come back they must reparse cleanly.
        const moveBytes = itm.buildMoveEntryBytes!(pr, ["Abilities"], 0, "down");
        expect(moveBytes).toBeInstanceOf(Uint8Array);
        expect(itmParser.parse(moveBytes as Uint8Array).errors).toBeUndefined();
    });

    it("routes effect ops end-to-end and produces reparseable bytes", () => {
        if (!hasFixture) return;
        const pr = makeTwoAbilityBase();
        // effects[1] (index 1) is the first effect owned by ability1 (slice [1,2]); editing it touches an
        // ability-owned range cleanly. Each op proves the adapter delegates Effects -> effect builders.

        const removeBytes = itm.buildRemoveEntryBytes!(pr, ["Effects"], 2);
        expect(removeBytes).toBeInstanceOf(Uint8Array);
        expect(itmParser.parse(removeBytes as Uint8Array).errors).toBeUndefined();

        const insertBytes = itm.buildInsertEntryBytes!(pr, ["Effects"], 1, "after");
        expect(insertBytes).toBeInstanceOf(Uint8Array);
        expect(itmParser.parse(insertBytes as Uint8Array).errors).toBeUndefined();

        const duplicateBytes = itm.buildDuplicateEntryBytes!(pr, ["Effects"], 1);
        expect(duplicateBytes).toBeInstanceOf(Uint8Array);
        expect(itmParser.parse(duplicateBytes as Uint8Array).errors).toBeUndefined();

        // effects[1] (opcode 20) and effects[2] (opcode 21) are both owned by ability1, so moving
        // index 1 down is a same-owner swap that returns bytes (not a cross-owner boundary no-op).
        const moveBytes = itm.buildMoveEntryBytes!(pr, ["Effects"], 1, "down");
        expect(moveBytes).toBeInstanceOf(Uint8Array);
        expect(itmParser.parse(moveBytes as Uint8Array).errors).toBeUndefined();
    });
});
