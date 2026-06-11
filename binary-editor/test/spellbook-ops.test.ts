import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore, type EditorSession } from "../src/session";
import { spellbookEdit } from "../src/spellbook-ops";
import { projectSpellbook, type SpellbookView } from "../src/spellbook";
import { undo } from "../src/structure-ops";
import { editField } from "../src/edit";
import { serializeSession } from "../src/serialize";
import { childGroups, fieldsByKey, findGroup, normKey } from "../src/relationship/model-helpers";

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
        // Still serializes, and undo restores the original slot count.
        expect(() => serializeSession(s)).not.toThrow();
        undo(s);
        expect(level(view(s), 1, 0)!.slots.length).toBe(before);
    });

    it("memorize into an empty level (capacity, no entries) works", () => {
        const s = open();
        // Find a wizard level with capacity but no slots (Edwin has higher empty rows). If none, skip the body.
        const empty = wizard(view(s)).levels.find((l) => l.slots.length === 0 && l.ownerNodeId !== undefined);
        if (!empty) return;
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

    it("addLevel: adds a memorization row for a new (type, level), making a fresh type group appear", () => {
        const s = open();
        expect(view(s).types.some((t) => t.type === 0)).toBe(false); // Edwin has no Priest rows
        spellbookEdit(s, { op: "addLevel", spellType: 0, spellLevel: 0 });
        const priest = view(s).types.find((t) => t.type === 0);
        expect(priest).toBeDefined();
        expect(priest!.levels.some((l) => l.level === 0 && l.ownerNodeId !== undefined)).toBe(true);
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
