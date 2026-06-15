import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore, type EditorSession } from "../src/session";
import { spellbookEdit } from "../src/spellbook-ops";
import { projectSpellbook, type SpellbookView } from "../src/spellbook";
import { undo, structureOp } from "../src/structure-ops";
import { editField } from "../src/edit";
import { serializeSession } from "../src/serialize";
import { childGroups, fieldsByKey, findGroup, normKey } from "../src/relationship/model-helpers";
import { creParser } from "../../binary/src/cre/index";

const CRE_FIXTURE = path.resolve(__dirname, "../../external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre");
const present = fs.existsSync(CRE_FIXTURE);
const maybe = present ? describe : describe.skip;

function open(): EditorSession {
    const { sessionId } = openSession("file:///edwin6.cre", new Uint8Array(fs.readFileSync(CRE_FIXTURE)));
    return sessionStore.get(sessionId)!;
}
const view = (s: EditorSession): SpellbookView => projectSpellbook(s.model);
const wizard = (v: SpellbookView) => v.types.find((t) => t.type === 1)!;
const level = (v: SpellbookView, type: number, lvl: number) =>
    v.types.find((t) => t.type === type)?.levels.find((l) => l.level === lvl);
const totalSlots = (v: SpellbookView): number =>
    v.types.reduce((n, t) => n + t.levels.reduce((m, l) => m + l.slots.length, 0), 0);

maybe("spellbookEdit", () => {
    it("memorize: adds a memorized slot to the level with the resref + Memorized flag set", () => {
        const s = open();
        const l1 = level(view(s), 1, 0)!; // Wizard L1
        const before = l1.slots.length;
        const total = totalSlots(view(s));
        spellbookEdit(s, { op: "memorize", ownerNodeId: l1.ownerNodeId!, resref: "SPWI120" });
        const l1b = level(view(s), 1, 0)!;
        expect(l1b.slots.length).toBe(before + 1);
        expect(totalSlots(view(s))).toBe(total + 1);
        // The new slot carries the chosen resref and is flagged Memorized (bit0).
        const added = l1b.slots.find((sl) => sl.resref === "SPWI120")!;
        expect(added).toBeDefined();
        expect(added.flags & 1).toBe(1);
        // Serializes to bytes that re-parse cleanly (round-trip sanity).
        const serialized = serializeSession(s);
        expect(serialized.length).toBeGreaterThan(0);
        const reparsed = creParser.parse(serialized);
        expect(reparsed.errors).toBeUndefined();
        undo(s);
        expect(level(view(s), 1, 0)!.slots.length).toBe(before);
    });

    it("a spellbook structure op refreshes the Spells tab count in its changeSet", () => {
        const s = open();
        const l1 = level(view(s), 1, 0)!; // Wizard L1
        // Edwin opens at 8 known / 11 memorized; memorizing one bumps the memorized total to 12.
        const res = spellbookEdit(s, { op: "memorize", ownerNodeId: l1.ownerNodeId!, resref: "X" });
        expect(res.changeSet.tabCounts?.spells).toBe("8/12");
    });

    it("memorize past capacity auto-bumps base and effective by 1 each", () => {
        const s = open();
        const l1 = level(view(s), 1, 0)!; // Wizard L1: at capacity (5/5, 5 memorized)
        const base0 = l1.numMemorizable!;
        const eff0 = l1.numMemorizableEffective!;
        expect(l1.slots.length).toBe(eff0); // sanity: already at effective capacity
        spellbookEdit(s, { op: "memorize", ownerNodeId: l1.ownerNodeId!, resref: "SPNEW1" });
        const after = level(view(s), 1, 0)!;
        expect(after.numMemorizable).toBe(base0 + 1);
        expect(after.numMemorizableEffective).toBe(eff0 + 1);
    });

    it("memorize under capacity does NOT bump, and removing a slot never decreases capacity", () => {
        const s = open();
        const l1 = level(view(s), 1, 0)!;
        // Make L1 under capacity: raise effective above the memorized count.
        editField(s, l1.numMemorizableEffectiveNodeId!, l1.numMemorizableEffective! + 2);
        const under = level(view(s), 1, 0)!;
        const eff = under.numMemorizableEffective!;
        spellbookEdit(s, { op: "memorize", ownerNodeId: under.ownerNodeId!, resref: "SPNEW2" });
        expect(level(view(s), 1, 0)!.numMemorizableEffective).toBe(eff); // under capacity -> no bump
        // Removing a memorized slot must never lower capacity.
        const slot = level(view(s), 1, 0)!.slots[0]!;
        structureOp(s, { op: "remove", entryId: slot.nodeId });
        expect(level(view(s), 1, 0)!.numMemorizableEffective).toBe(eff);
    });

    it("memorize into an empty level (capacity, no entries) works", () => {
        const s = open();
        // Edwin has wizard levels at L5-L9 with capacity rows but no memorized entries.
        const empty = wizard(view(s)).levels.find((l) => l.slots.length === 0 && l.ownerNodeId !== undefined);
        expect(empty).toBeDefined();
        if (!empty) throw new Error("fixture has no empty wizard level with a capacity row");
        spellbookEdit(s, { op: "memorize", ownerNodeId: empty.ownerNodeId!, resref: "SPWI805" });
        const after = wizard(view(s)).levels.find((l) => l.level === empty.level)!;
        expect(after.slots.some((sl) => sl.resref === "SPWI805")).toBe(true);
    });

    it("addKnown: places a known spell under the requested (type, level)", () => {
        const s = open();
        // Wizard L8 (level index 7) - Edwin does not know one there.
        spellbookEdit(s, { op: "addKnown", spellType: 1, spellLevel: 7, resref: "SPWI810" });
        const v = view(s);
        const l8 = level(v, 1, 7);
        expect(l8).toBeDefined();
        expect(l8!.known.some((k) => k.resref === "SPWI810")).toBe(true);
        undo(s);
        expect(level(view(s), 1, 7)?.known.some((k) => k.resref === "SPWI810") ?? false).toBe(false);
    });

    it("addLevel adds an absent level, and a repeat for the same (type, level) is a no-op (double-click safe)", () => {
        const s = open();
        // Edwin has an Innate L0 row but none at L2; the UI offers "add level" only for absent levels like this.
        const innateRows = (lvl: number) =>
            view(s)
                .types.find((t) => t.type === 2)
                ?.levels.filter((l) => l.level === lvl).length ?? 0;
        expect(innateRows(2)).toBe(0);
        spellbookEdit(s, { op: "addLevel", spellType: 2, spellLevel: 2 });
        expect(innateRows(2)).toBe(1);
        const added = view(s)
            .types.find((t) => t.type === 2)!
            .levels.find((l) => l.level === 2)!;
        expect(added.ownerNodeId).not.toBeUndefined();
        // A double-click fires addLevel twice for the same target before the view refreshes; the second no-ops.
        spellbookEdit(s, { op: "addLevel", spellType: 2, spellLevel: 2 });
        expect(innateRows(2)).toBe(1);
    });

    it("addLevel seeds the new level with one memorizable slot (base 1, eff 1) so it is usable at once", () => {
        const s = open();
        spellbookEdit(s, { op: "addLevel", spellType: 2, spellLevel: 2 }); // Innate L2, absent on Edwin
        const added = level(view(s), 2, 2)!;
        expect(added.numMemorizable).toBe(1);
        expect(added.numMemorizableEffective).toBe(1);
    });

    // Find the Memorized Spell Count field node of the Wizard Lvl-1 memorization row, to corrupt the range.
    const l1CountNodeId = (s: EditorSession): string => {
        const meminfo = findGroup(s.model, "Spell Memorization Info")!;
        const row = childGroups(s.model, meminfo).find((g) => {
            const f = fieldsByKey(s.model, g);
            return (
                f.get(normKey("Spell Type"))?.source &&
                Number((f.get(normKey("Spell Type"))!.source as { rawValue?: unknown }).rawValue) === 1 &&
                Number((f.get(normKey("Spell Level"))!.source as { rawValue?: unknown }).rawValue) === 0
            );
        })!;
        return fieldsByKey(s.model, row).get(normKey("Memorized Spell Count"))!.id;
    };

    it("normalize: shrinking a range orphans entries; removeOrphan drops one and shrinks the bucket", () => {
        const s = open();
        // Total memorized entries = cleanly-owned slots + bucketed (orphan/contested) entries.
        const totalEntries = (v: SpellbookView): number => totalSlots(v) + v.bucket.length;
        const before = totalEntries(view(s));
        // Edwin's Wizard L1 has 5 memorized. Shrink the count to 3 -> entries #3,#4 become orphaned (no entry lost).
        editField(s, l1CountNodeId(s), 3);
        const v1 = view(s);
        expect(v1.bucket.length).toBe(2);
        expect(v1.bucket.every((b) => b.reason === "orphan")).toBe(true);
        expect(level(v1, 1, 0)!.slots.length).toBe(3);
        expect(totalEntries(v1)).toBe(before); // shrink reassigns entries to the bucket, removes none
        // Remove one orphan -> bucket shrinks AND one memorized entry is actually dropped.
        spellbookEdit(s, { op: "removeOrphan", memorizedIndex: v1.bucket[0]!.memorizedIndex });
        const v2 = view(s);
        expect(v2.bucket.length).toBe(1);
        expect(totalEntries(v2)).toBe(before - 1);
    });

    it("normalize: overrunning a range flags the level and offers a clamp fix that clears it", () => {
        const s = open();
        // Push Wizard L1's count past the table -> overrun. The level flags with a clampCountFix.
        editField(s, l1CountNodeId(s), 999);
        const flagged = level(view(s), 1, 0)!;
        expect(flagged.flagged).toBe(true);
        expect(flagged.clampCountFix).toBeDefined();
        // Apply the clamp (a plain field edit) -> the level is consistent again.
        editField(s, flagged.clampCountFix!.nodeId, flagged.clampCountFix!.value);
        expect(level(view(s), 1, 0)!.flagged).toBe(false);
    });
});
