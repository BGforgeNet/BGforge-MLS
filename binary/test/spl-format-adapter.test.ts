import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatAdapterRegistry } from "../src/format-adapter";
import { splParser } from "../src/spl";
import { getSplCanonicalDocument, rebuildSplCanonicalDocument } from "../src/spl/canonical-reader";
import { serializeSplCanonicalDocument } from "../src/spl/canonical-writer";
import { defaultSplAbility, isSplAddableArray, isSplListSection, isSplModifiableArray } from "../src/spl/entity-ops";
import { defaultIeEffect } from "../src/ie-common/structure-ops";
import type { ParseResult } from "../src/types";

const spl = formatAdapterRegistry.get("spl")!;

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/Ascension/ascension/powers/resource/berserk.spl");
const hasFixture = fs.existsSync(FIXTURE);

/**
 * Build a synthetic 2-ability SPL where ability0 owns effect[0] and ability1
 * owns effects[1,2]. This is the shape the entity-ops tests use (see
 * makeTwoAbilityBase there): the real fixture may have a degenerate partition
 * that some effect ops legitimately decline. This base lets the adapter-routing
 * smoke tests exercise every op end-to-end with bytes that actually come back.
 */
function makeTwoAbilityBase(): ParseResult {
    const parsed = splParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
    if (parsed.errors) throw new Error(parsed.errors.join(", "));
    const doc = getSplCanonicalDocument(parsed) ?? rebuildSplCanonicalDocument(parsed);
    if (!doc) throw new Error("no canonical doc");

    const effect = (opcode: number) => ({ ...defaultIeEffect(), opcode });
    const base = {
        ...doc,
        header: { ...doc.header, castingFeatureBlocksIndex: 0, castingFeatureBlocksCount: 0 },
        abilities: [
            { ...defaultSplAbility(), featureBlocksOffset: 0, featureBlocksCount: 1 },
            { ...defaultSplAbility(), featureBlocksOffset: 1, featureBlocksCount: 2 },
        ],
        effects: [effect(10), effect(20), effect(21)],
    };

    const reparsed = splParser.parse(serializeSplCanonicalDocument(base));
    if (reparsed.errors) throw new Error(`base reparse errors: ${reparsed.errors.join(", ")}`);
    return reparsed;
}

describe("spl adapter structure-op surface", () => {
    it("classifies Abilities and Effects as modifiable list sections", () => {
        expect(isSplListSection(["Abilities"])).toBe(true);
        expect(isSplListSection(["Effects"])).toBe(true);
        expect(isSplListSection(["SPL Header"])).toBe(false);
        expect(isSplModifiableArray(["Abilities"])).toBe(true);
        expect(isSplModifiableArray(["Effects"])).toBe(true);
    });

    it("offers section-level add on both Abilities and Effects (Effects add appends a global effect)", () => {
        expect(isSplAddableArray(["Abilities"])).toBe(true);
        expect(isSplAddableArray(["Effects"])).toBe(true);
    });

    it("recognizes ability and effect entry paths as removable", () => {
        expect(spl.isRemovableEntry!(["Abilities", "Ability 1"])).toBe(true);
        expect(spl.isRemovableEntry!(["Effects", "Effect 1"])).toBe(true);
        expect(spl.isRemovableEntry!(["SPL Header", "Signature"])).toBe(false);
    });

    it("rejects non-list-section paths for all predicates", () => {
        expect(isSplListSection(["SPL File"])).toBe(false);
        expect(isSplModifiableArray(["SPL File"])).toBe(false);
        expect(isSplAddableArray(["SPL File"])).toBe(false);
        expect(spl.isRemovableEntry!(["SPL File", "Abilities"])).toBe(false);
    });

    it("buildAddEntryBytes returns bytes for Abilities and Effects (Effects adds a global effect)", () => {
        if (!hasFixture) return;
        const pr = splParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        expect(pr.errors).toBeUndefined();
        const abilityBytes = spl.buildAddEntryBytes!(pr, ["Abilities"]);
        expect(abilityBytes).toBeInstanceOf(Uint8Array);
        expect((abilityBytes as Uint8Array).byteLength).toBeGreaterThan(0);
        // Effects now supports a section-level add (the new effect is a global/casting effect).
        const effectBytes = spl.buildAddEntryBytes!(pr, ["Effects"]);
        expect(effectBytes).toBeInstanceOf(Uint8Array);
        expect((effectBytes as Uint8Array).byteLength).toBeGreaterThan(0);
    });

    // End-to-end routing smoke tests: prove the adapter delegates Abilities->ability builders and
    // Effects->effect builders for every op (not just at the predicate layer). Bytes that come back
    // are reparsed to confirm the routed builder produced a valid SPL. Builder-internals are covered
    // in spl-entity-ops.test.ts; these stay tight.
    it("routes ability ops end-to-end and produces reparseable bytes", () => {
        if (!hasFixture) return;
        const pr = makeTwoAbilityBase();

        const removeBytes = spl.buildRemoveEntryBytes!(pr, ["Abilities"], 0);
        expect(removeBytes).toBeInstanceOf(Uint8Array);
        expect(splParser.parse(removeBytes as Uint8Array).errors).toBeUndefined();

        const insertBytes = spl.buildInsertEntryBytes!(pr, ["Abilities"], 0, "after");
        expect(insertBytes).toBeInstanceOf(Uint8Array);
        expect(splParser.parse(insertBytes as Uint8Array).errors).toBeUndefined();

        const duplicateBytes = spl.buildDuplicateEntryBytes!(pr, ["Abilities"], 0);
        expect(duplicateBytes).toBeInstanceOf(Uint8Array);
        expect(splParser.parse(duplicateBytes as Uint8Array).errors).toBeUndefined();

        // Two abilities, so moving index 0 down swaps with index 1 and yields bytes (not a boundary
        // no-op). The contract stays bytes-or-undefined; when bytes come back they must reparse cleanly.
        const moveBytes = spl.buildMoveEntryBytes!(pr, ["Abilities"], 0, "down");
        expect(moveBytes).toBeInstanceOf(Uint8Array);
        expect(splParser.parse(moveBytes as Uint8Array).errors).toBeUndefined();
    });

    it("routes effect ops end-to-end and produces reparseable bytes", () => {
        if (!hasFixture) return;
        const pr = makeTwoAbilityBase();
        // effects[1] (index 1) is the first effect owned by ability1 (slice [1,2]); editing it touches an
        // ability-owned range cleanly. Each op proves the adapter delegates Effects -> effect builders.

        const removeBytes = spl.buildRemoveEntryBytes!(pr, ["Effects"], 2);
        expect(removeBytes).toBeInstanceOf(Uint8Array);
        expect(splParser.parse(removeBytes as Uint8Array).errors).toBeUndefined();

        const insertBytes = spl.buildInsertEntryBytes!(pr, ["Effects"], 1, "after");
        expect(insertBytes).toBeInstanceOf(Uint8Array);
        expect(splParser.parse(insertBytes as Uint8Array).errors).toBeUndefined();

        const duplicateBytes = spl.buildDuplicateEntryBytes!(pr, ["Effects"], 1);
        expect(duplicateBytes).toBeInstanceOf(Uint8Array);
        expect(splParser.parse(duplicateBytes as Uint8Array).errors).toBeUndefined();

        // effects[1] (opcode 20) and effects[2] (opcode 21) are both owned by ability1, so moving
        // index 1 down is a same-owner swap that returns bytes (not a cross-owner boundary no-op).
        const moveBytes = spl.buildMoveEntryBytes!(pr, ["Effects"], 1, "down");
        expect(moveBytes).toBeInstanceOf(Uint8Array);
        expect(splParser.parse(moveBytes as Uint8Array).errors).toBeUndefined();
    });

    // End-to-end op: call buildAddEntryBytes, reparse, confirm ability count grew by 1.
    it.skipIf(!hasFixture)("buildAddEntryBytes for Abilities produces a reparseable SPL with one more ability", () => {
        const pr = splParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        expect(pr.errors).toBeUndefined();
        const docBefore = getSplCanonicalDocument(pr) ?? rebuildSplCanonicalDocument(pr);
        const countBefore = docBefore.abilities.length;

        const bytes = spl.buildAddEntryBytes!(pr, ["Abilities"]);
        expect(bytes).toBeInstanceOf(Uint8Array);
        const reparsed = splParser.parse(bytes as Uint8Array);
        expect(reparsed.errors).toBeUndefined();
        const docAfter = getSplCanonicalDocument(reparsed) ?? rebuildSplCanonicalDocument(reparsed);
        expect(docAfter.abilities.length).toBe(countBefore + 1);
    });
});
