import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { creParser } from "../src/cre";
import { getCreCanonicalDocument, rebuildCreCanonicalDocument } from "../src/cre/canonical-reader";
import { serializeCreCanonicalDocument } from "../src/cre/canonical-writer";
import {
    buildCreAddEntryBytes,
    buildCreDuplicateEntryBytes,
    buildCreInsertEntryBytes,
    buildCreMoveEntryBytes,
    buildCreRemoveEntryBytes,
    defaultCreItem,
    defaultCreKnownSpell,
    defaultCreMemorizedSpell,
    defaultCreSpellMemInfo,
    isCreAddableArray,
    isCreListSection,
    isCreRemovableEntry,
    relinkItemSlots,
} from "../src/cre/entity-ops";
import { CRE_GROUP_LABELS, CRE_ITEM_SLOT_COUNT } from "../src/cre/types";
import { computeCreSectionOffsets, type CreCanonicalDocument } from "../src/cre/canonical-schemas";
import type { ParseResult } from "../src/types";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXTERNAL_ROOT = path.join(REPO_ROOT, "external/infinity-engine");

function findFixtures(root: string): string[] {
    const out: string[] = [];
    function walk(dir: string): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.isFile() && e.name.toLowerCase().endsWith(".cre")) out.push(full);
        }
    }
    if (fs.existsSync(root)) walk(root);
    return out.sort();
}

function docOf(result: ParseResult): CreCanonicalDocument {
    const doc = getCreCanonicalDocument(result) ?? rebuildCreCanonicalDocument(result);
    if (!doc) throw new Error("no CRE document");
    return doc;
}

const strip = (s: string): string => {
    const nul = s.indexOf("\u0000");
    return nul === -1 ? s : s.slice(0, nul);
};

/**
 * Stamp freshly-computed section offsets into the header so a synthetic base
 * (built by overriding arrays on a real fixture doc) has no stale offset. The
 * writer preserves the doc's offset for any EMPTY section (nonEmptyCreSectionOffsets),
 * which would otherwise leave a real-fixture offset that points past the smaller
 * synthetic file. Real ops never hit this; it is purely a test-base concern.
 */
function normalize(doc: CreCanonicalDocument): CreCanonicalDocument {
    const o = computeCreSectionOffsets(doc);
    return {
        ...doc,
        header: {
            ...doc.header,
            knownSpellsOffset: o.knownSpells,
            spellMemInfoOffset: o.spellMemInfo,
            memorizedSpellsOffset: o.memorizedSpells,
            effectsOffset: o.effects,
            itemsOffset: o.items,
            itemSlotsOffset: o.itemSlots,
        },
    };
}

/** Serialize a controlled doc and reparse it into a clean ParseResult (exercises the real producer). */
function parseResultFrom(doc: CreCanonicalDocument): ParseResult {
    const r = creParser.parse(serializeCreCanonicalDocument(normalize(doc)));
    if (r.errors) throw new Error(`base reparse errors: ${r.errors.join(", ")}`);
    return r;
}

const fixtures = findFixtures(EXTERNAL_ROOT);

/** Pick a real fixture doc of the given effect kind to use as a passthrough base. */
function baseDocOfKind(kind: "v1" | "v2"): CreCanonicalDocument {
    for (const f of fixtures) {
        const r = creParser.parse(new Uint8Array(fs.readFileSync(f)));
        if (r.errors) continue;
        const doc = docOf(r);
        if (doc.effects.kind === kind) return doc;
    }
    throw new Error(`no ${kind} fixture`);
}

if (fixtures.length === 0) {
    describe.skip("cre entity-ops (no fixtures)", () => {
        it("skipped", () => {});
    });
}

// ---------------------------------------------------------------------------
// Memorization owner+slice ops (spellMemInfo / memorizedSpells), order-agnostic.
// ---------------------------------------------------------------------------
describe("CRE memorization owner+slice ops", () => {
    const memSpell = (spell: string) => ({ ...defaultCreMemorizedSpell(), spell });
    const owner = (start: number, count: number, level: number) => ({
        ...defaultCreSpellMemInfo(),
        firstMemorizedSpellIndex: start,
        memorizedSpellCount: count,
        spellLevel: level,
    });

    /** owner0 -> [AAA]; owner1 -> [BBB, CCC]. Distinct resrefs prove which record moved. */
    function inOrderBase(): CreCanonicalDocument {
        return {
            ...baseDocOfKind("v1"),
            spellMemInfo: [owner(0, 1, 1), owner(1, 2, 2)],
            memorizedSpells: [memSpell("AAA"), memSpell("BBB"), memSpell("CCC")],
        };
    }

    /** owner0 -> [AAA] (idx0); owner1 -> [CCC] (idx2); owner2 -> [BBB] (idx1). Out of owner order (quayle-shaped). */
    function outOfOrderBase(): CreCanonicalDocument {
        return {
            ...baseDocOfKind("v1"),
            spellMemInfo: [owner(0, 1, 1), owner(2, 1, 2), owner(1, 1, 3)],
            memorizedSpells: [memSpell("AAA"), memSpell("BBB"), memSpell("CCC")],
        };
    }

    const ownerPath = (n: number) => [CRE_GROUP_LABELS.spellMemInfo, `Entry ${n}`];
    const slicePath = (n: number) => [CRE_GROUP_LABELS.memorizedSpells, `Memorized Spell ${n}`];
    const memrefs = (d: CreCanonicalDocument) => d.memorizedSpells.map((m) => strip(m.spell));
    const ranges = (d: CreCanonicalDocument) =>
        d.spellMemInfo.map((e) => [e.firstMemorizedSpellIndex, e.memorizedSpellCount]);

    it("insert memorized spell into owner0 grows owner0 and shifts owner1", () => {
        const bytes = buildCreInsertEntryBytes(parseResultFrom(inOrderBase()), slicePath(1), "after");
        const d = docOf(creParser.parse(bytes!));
        expect(memrefs(d)).toEqual(["AAA", "", "BBB", "CCC"]); // new empty spell after AAA
        expect(ranges(d)).toEqual([
            [0, 2],
            [2, 2],
        ]);
    });

    it("remove a memorized spell shrinks its owner and shifts later owners", () => {
        const bytes = buildCreRemoveEntryBytes(parseResultFrom(inOrderBase()), slicePath(2)); // remove BBB (owner1)
        const d = docOf(creParser.parse(bytes!));
        expect(memrefs(d)).toEqual(["AAA", "CCC"]);
        expect(ranges(d)).toEqual([
            [0, 1],
            [1, 1],
        ]);
    });

    it("duplicate a memorized spell clones it under the same owner", () => {
        const bytes = buildCreDuplicateEntryBytes(parseResultFrom(inOrderBase()), slicePath(2)); // duplicate BBB
        const d = docOf(creParser.parse(bytes!));
        expect(memrefs(d)).toEqual(["AAA", "BBB", "BBB", "CCC"]);
        expect(ranges(d)).toEqual([
            [0, 1],
            [1, 3],
        ]);
    });

    it("reorder memorized spells within an owner swaps them; rejects a cross-owner move", () => {
        const within = buildCreMoveEntryBytes(parseResultFrom(inOrderBase()), slicePath(2), "down"); // BBB<->CCC, same owner1
        expect(memrefs(docOf(creParser.parse(within!)))).toEqual(["AAA", "CCC", "BBB"]);
        // slicePath(1)=AAA (owner0) moving down would cross into owner1 -> rejected.
        expect(buildCreMoveEntryBytes(parseResultFrom(inOrderBase()), slicePath(1), "down")).toBeUndefined();
    });

    it("add an owner appends an empty memorization entry, slices unchanged", () => {
        const bytes = buildCreAddEntryBytes(parseResultFrom(inOrderBase()), [CRE_GROUP_LABELS.spellMemInfo]);
        const d = docOf(creParser.parse(bytes!));
        expect(memrefs(d)).toEqual(["AAA", "BBB", "CCC"]);
        expect(d.spellMemInfo).toHaveLength(3);
        expect(ranges(d)[2]).toEqual([0, 0]);
    });

    it("remove an owner drops its slice and shifts later owners down", () => {
        const bytes = buildCreRemoveEntryBytes(parseResultFrom(inOrderBase()), ownerPath(1)); // remove owner0 ([AAA])
        const d = docOf(creParser.parse(bytes!));
        expect(memrefs(d)).toEqual(["BBB", "CCC"]);
        expect(ranges(d)).toEqual([[0, 2]]);
    });

    it("reorder owners swaps records without moving slices", () => {
        const bytes = buildCreMoveEntryBytes(parseResultFrom(inOrderBase()), ownerPath(1), "down");
        const d = docOf(creParser.parse(bytes!));
        expect(memrefs(d)).toEqual(["AAA", "BBB", "CCC"]); // slices untouched
        expect(ranges(d)).toEqual([
            [1, 2],
            [0, 1],
        ]); // owner records swapped, each keeps its range
    });

    it("duplicate an owner clones its slice in place and points the clone at it", () => {
        const bytes = buildCreDuplicateEntryBytes(parseResultFrom(inOrderBase()), ownerPath(2)); // duplicate owner1 ([BBB,CCC])
        const d = docOf(creParser.parse(bytes!));
        expect(memrefs(d)).toEqual(["AAA", "BBB", "CCC", "BBB", "CCC"]);
        expect(ranges(d)).toEqual([
            [0, 1],
            [1, 2],
            [3, 2],
        ]);
    });

    it("handles an OUT-OF-ORDER partition (quayle case): duplicate owner1 -> CCC", () => {
        const bytes = buildCreDuplicateEntryBytes(parseResultFrom(outOfOrderBase()), ownerPath(2)); // owner1 owns idx2 = CCC
        const d = docOf(creParser.parse(bytes!));
        // Clone slice inserted at owner1.start+count = 3 (append). Clone owns the new CCC.
        expect(memrefs(d)).toEqual(["AAA", "BBB", "CCC", "CCC"]);
        const r = ranges(d);
        expect(r[1]).toEqual([2, 1]); // source unchanged
        expect(r[2]).toEqual([3, 1]); // clone inserted right after source, points at the appended CCC
        expect(r[3]).toEqual([1, 1]); // owner2 (owns BBB at idx1) unshifted
    });

    it("out-of-order remove owner shifts only later-starting owners", () => {
        // Remove owner0 (idx0). owner1 start 2 -> 1, owner2 start 1 -> 1 (start 1 < removed end 1? removed [0,1))
        const bytes = buildCreRemoveEntryBytes(parseResultFrom(outOfOrderBase()), ownerPath(1));
        const d = docOf(creParser.parse(bytes!));
        expect(memrefs(d)).toEqual(["BBB", "CCC"]); // AAA removed
        // After removing index0: BBB now idx0, CCC idx1. owner1 owned CCC, owner2 owned BBB.
        expect(ranges(d)).toEqual([
            [1, 1], // was owner1 (CCC), start 2 -> 1
            [0, 1], // was owner2 (BBB), start 1 -> 0
        ]);
    });
});

// ---------------------------------------------------------------------------
// Flat lists: known spells + effects (v1/v2 kind-preserving).
// ---------------------------------------------------------------------------
describe("CRE flat-list ops (known spells, effects)", () => {
    function knownBase(): CreCanonicalDocument {
        return {
            ...baseDocOfKind("v1"),
            knownSpells: [
                { ...defaultCreKnownSpell(), spell: "K1" },
                { ...defaultCreKnownSpell(), spell: "K2" },
            ],
        };
    }
    const krefs = (d: CreCanonicalDocument) => d.knownSpells.map((k) => strip(k.spell));

    it("add/insert/remove/duplicate/reorder a known spell", () => {
        const KS = CRE_GROUP_LABELS.knownSpells;
        const add = docOf(creParser.parse(buildCreAddEntryBytes(parseResultFrom(knownBase()), [KS])!));
        expect(krefs(add)).toEqual(["K1", "K2", ""]);
        const ins = docOf(
            creParser.parse(buildCreInsertEntryBytes(parseResultFrom(knownBase()), [KS, "Known Spell 1"], "before")!),
        );
        expect(krefs(ins)).toEqual(["", "K1", "K2"]);
        const rem = docOf(
            creParser.parse(buildCreRemoveEntryBytes(parseResultFrom(knownBase()), [KS, "Known Spell 1"])!),
        );
        expect(krefs(rem)).toEqual(["K2"]);
        const dup = docOf(
            creParser.parse(buildCreDuplicateEntryBytes(parseResultFrom(knownBase()), [KS, "Known Spell 2"])!),
        );
        expect(krefs(dup)).toEqual(["K1", "K2", "K2"]);
        const mv = docOf(
            creParser.parse(buildCreMoveEntryBytes(parseResultFrom(knownBase()), [KS, "Known Spell 1"], "down")!),
        );
        expect(krefs(mv)).toEqual(["K2", "K1"]);
    });

    it("adds an effect preserving the v1 kind", () => {
        const base: CreCanonicalDocument = {
            ...baseDocOfKind("v1"),
            effects: { kind: "v1", records: [] },
        };
        const d = docOf(creParser.parse(buildCreAddEntryBytes(parseResultFrom(base), [CRE_GROUP_LABELS.effects])!));
        expect(d.effects.kind).toBe("v1");
        expect(d.effects.records).toHaveLength(1);
    });

    it("adds an effect preserving the v2 kind", () => {
        const base: CreCanonicalDocument = {
            ...baseDocOfKind("v2"),
            effects: { kind: "v2", records: [] },
        };
        const d = docOf(creParser.parse(buildCreAddEntryBytes(parseResultFrom(base), [CRE_GROUP_LABELS.effects])!));
        expect(d.effects.kind).toBe("v2");
        expect(d.effects.records).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Items <- itemSlots back-reference relink.
// ---------------------------------------------------------------------------
describe("CRE items + itemSlots relink", () => {
    function itemsBase(slots: Partial<Record<number, number>>): CreCanonicalDocument {
        const itemSlots = Array.from({ length: CRE_ITEM_SLOT_COUNT }, (_, i) => slots[i] ?? -1);
        return {
            ...baseDocOfKind("v1"),
            items: [
                { ...defaultCreItem(), item: "ITM0" },
                { ...defaultCreItem(), item: "ITM1" },
                { ...defaultCreItem(), item: "ITM2" },
            ],
            itemSlots,
        };
    }
    const itemPath = (n: number) => [CRE_GROUP_LABELS.items, `Item ${n}`];

    it("remove item clears its slot and shifts higher refs down", () => {
        // slot0 -> item0, slot1 -> item2, slot38 -> 9 (weapon slot, untouched).
        const base = itemsBase({ 0: 0, 1: 2, 38: 9 });
        const d = docOf(creParser.parse(buildCreRemoveEntryBytes(parseResultFrom(base), itemPath(1))!)); // remove item0
        expect(d.items.map((i) => strip(i.item))).toEqual(["ITM1", "ITM2"]);
        expect(d.itemSlots[0]).toBe(-1); // referenced removed item
        expect(d.itemSlots[1]).toBe(1); // item2 (now index1) still pointed at
        expect(d.itemSlots[38]).toBe(9); // weapon-slot index untouched
    });

    it("insert item shifts refs at/after the insertion point up", () => {
        const base = itemsBase({ 0: 0, 1: 2 });
        const d = docOf(creParser.parse(buildCreInsertEntryBytes(parseResultFrom(base), itemPath(1), "before")!)); // insert at 0
        expect(d.items.map((i) => strip(i.item))).toEqual(["", "ITM0", "ITM1", "ITM2"]);
        expect(d.itemSlots[0]).toBe(1); // item0 -> index1
        expect(d.itemSlots[1]).toBe(3); // item2 -> index3
    });

    it("reorder items swaps the two referencing slots", () => {
        const base = itemsBase({ 0: 0, 5: 1 });
        const d = docOf(creParser.parse(buildCreMoveEntryBytes(parseResultFrom(base), itemPath(1), "down")!)); // swap item0,item1
        expect(d.items.map((i) => strip(i.item))).toEqual(["ITM1", "ITM0", "ITM2"]);
        expect(d.itemSlots[0]).toBe(1); // was ref to 0
        expect(d.itemSlots[5]).toBe(0); // was ref to 1
    });

    it("relinkItemSlots leaves the trailing weapon-slot entries alone", () => {
        const slots = Array.from({ length: CRE_ITEM_SLOT_COUNT }, () => -1);
        slots[CRE_ITEM_SLOT_COUNT - 2] = 5; // selected weapon slot
        slots[CRE_ITEM_SLOT_COUNT - 1] = 3; // selected weapon ability
        const out = relinkItemSlots(slots, { next: [], op: "remove", index: 0, delta: -1 }, 0);
        expect(out[CRE_ITEM_SLOT_COUNT - 2]).toBe(5);
        expect(out[CRE_ITEM_SLOT_COUNT - 1]).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Adapter predicates.
// ---------------------------------------------------------------------------
describe("CRE adapter predicates", () => {
    it("recognises the 5 list sections, not itemSlots/header", () => {
        for (const s of [
            CRE_GROUP_LABELS.knownSpells,
            CRE_GROUP_LABELS.spellMemInfo,
            CRE_GROUP_LABELS.memorizedSpells,
            CRE_GROUP_LABELS.effects,
            CRE_GROUP_LABELS.items,
        ]) {
            expect(isCreListSection([s])).toBe(true);
        }
        expect(isCreListSection([CRE_GROUP_LABELS.itemSlots])).toBe(false);
        expect(isCreListSection([CRE_GROUP_LABELS.header])).toBe(false);
    });

    it("memorized spells are NOT section-addable (owner-ambiguous), the rest are", () => {
        expect(isCreAddableArray([CRE_GROUP_LABELS.memorizedSpells])).toBe(false);
        expect(isCreAddableArray([CRE_GROUP_LABELS.spellMemInfo])).toBe(true);
        expect(isCreAddableArray([CRE_GROUP_LABELS.knownSpells])).toBe(true);
        expect(isCreAddableArray([CRE_GROUP_LABELS.effects])).toBe(true);
        expect(isCreAddableArray([CRE_GROUP_LABELS.items])).toBe(true);
    });

    it("recognises removable entries by section + prefix", () => {
        expect(isCreRemovableEntry([CRE_GROUP_LABELS.items, "Item 1"])).toBe(true);
        expect(isCreRemovableEntry([CRE_GROUP_LABELS.memorizedSpells, "Memorized Spell 3"])).toBe(true);
        expect(isCreRemovableEntry([CRE_GROUP_LABELS.itemSlots, "Helmet"])).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Fixture-driven semantic-identity regression (per the corruption-critical
// review): over EVERY real fixture, an owner duplicate/remove must preserve
// each surviving owner's memorized-spell resref multiset and keep the relaxed
// partition consistent. This catches a complete-but-wrong cross-reference that
// reparse-clean coverage alone would miss.
// ---------------------------------------------------------------------------
describe("CRE owner ops preserve cross-reference identity over real fixtures", () => {
    /** Each owner's slice as a sorted multiset of (level|resref) signatures. */
    function ownerSigs(doc: CreCanonicalDocument): string[][] {
        return doc.spellMemInfo.map((o) => {
            const start = o.firstMemorizedSpellIndex;
            return doc.memorizedSpells
                .slice(start, start + o.memorizedSpellCount)
                .map((m) => `${o.spellLevel}|${strip(m.spell)}`)
                .sort();
        });
    }

    const withOwner = fixtures.filter((f) => {
        const r = creParser.parse(new Uint8Array(fs.readFileSync(f)));
        if (r.errors) return false;
        const doc = getCreCanonicalDocument(r) ?? rebuildCreCanonicalDocument(r);
        return doc !== undefined && doc.spellMemInfo.some((o) => o.memorizedSpellCount > 0);
    });

    it("has fixtures with populated memorization owners to exercise", () => {
        expect(withOwner.length).toBeGreaterThan(0);
    });

    it.each(withOwner)("duplicate + remove first populated owner is identity-preserving: %s", (f) => {
        const base = docOf(creParser.parse(new Uint8Array(fs.readFileSync(f))));
        const idx = base.spellMemInfo.findIndex((o) => o.memorizedSpellCount > 0);
        const entry = [CRE_GROUP_LABELS.spellMemInfo, `Entry ${idx + 1}`];
        const sourceSig = ownerSigs(base)[idx]!;

        // Duplicate: clone owner appears right after source with the same multiset; nothing else changes.
        const dup = docOf(creParser.parse(buildCreDuplicateEntryBytes(parseResultFrom(base), entry)!));
        expect(ownerSigs(dup)[idx]).toEqual(sourceSig); // source unchanged
        expect(ownerSigs(dup)[idx + 1]).toEqual(sourceSig); // clone matches
        expect(dup.memorizedSpells.length).toBe(
            base.memorizedSpells.length + base.spellMemInfo[idx]!.memorizedSpellCount,
        );

        // Remove: source owner gone, every other owner's multiset preserved.
        const rem = docOf(creParser.parse(buildCreRemoveEntryBytes(parseResultFrom(base), entry)!));
        const before = ownerSigs(base).filter((_, i) => i !== idx);
        expect(ownerSigs(rem)).toEqual(before);
    });
});
