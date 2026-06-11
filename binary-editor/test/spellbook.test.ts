import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ParseResult } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { openSession, sessionStore } from "../src/session";
import { projectSpellbook, type SpellbookView } from "../src/spellbook";

// Synthetic CRE ParseResult builder for the spellbook join. Mirrors the real parser's humanized labels and
// value/raw shapes (verified against finaluf.CRE): spellType is an enum (code in rawValue), spell levels are
// 0-based, resrefs are string-valued, Memorized Flags carries the bitfield in rawValue.
const num = (name: string, value: number) => ({ name, value, rawValue: value });
const str = (name: string, value: string) => ({ name, value });
const grp = (name: string, fields: unknown[]) => ({ name, fields });

interface KnownSpec {
    resref: string;
    level: number;
    type: number;
}
interface MeminfoSpec {
    level: number;
    type: number;
    numMemorizable?: number;
    numMemorizableEffective?: number;
    start: number;
    count: number;
}
interface MemorizedSpec {
    resref: string;
    flags?: number;
}
interface SpellbookSpec {
    known?: KnownSpec[];
    meminfo?: MeminfoSpec[];
    memorized?: MemorizedSpec[];
}

function creResult(o: SpellbookSpec): ParseResult {
    return {
        format: "cre",
        formatName: "CRE",
        root: grp("CRE File", [
            grp(
                "Known Spells",
                (o.known ?? []).map((k, i) =>
                    grp(`Known Spell ${i + 1}`, [
                        str("Spell", k.resref),
                        num("Spell Level", k.level),
                        num("Spell Type", k.type),
                    ]),
                ),
            ),
            grp(
                "Spell Memorization Info",
                (o.meminfo ?? []).map((m, i) =>
                    grp(`Entry ${i + 1}`, [
                        num("Spell Level", m.level),
                        num("Num Memorizable", m.numMemorizable ?? 0),
                        num("Num Memorizable Effective", m.numMemorizableEffective ?? 0),
                        num("Spell Type", m.type),
                        num("First Memorized Spell Index", m.start),
                        num("Memorized Spell Count", m.count),
                    ]),
                ),
            ),
            grp(
                "Memorized Spells",
                (o.memorized ?? []).map((m, i) =>
                    grp(`Memorized Spell ${i + 1}`, [str("Spell", m.resref), num("Memorized Flags", m.flags ?? 1)]),
                ),
            ),
        ]),
    } as unknown as ParseResult;
}

const project = (o: SpellbookSpec): SpellbookView => projectSpellbook(buildModel(creResult(o)));
const levelOf = (v: SpellbookView, type: number, level: number) =>
    v.types.find((t) => t.type === type)?.levels.find((l) => l.level === level);

describe("projectSpellbook - clean data", () => {
    it("joins known + memorized under their (type, level) panels", () => {
        const v = project({
            known: [
                { resref: "SPWI112", level: 0, type: 1 },
                { resref: "SPWI201", level: 1, type: 1 },
            ],
            meminfo: [
                { level: 0, type: 1, numMemorizable: 2, numMemorizableEffective: 3, start: 0, count: 2 },
                { level: 1, type: 1, numMemorizable: 1, numMemorizableEffective: 1, start: 2, count: 1 },
            ],
            memorized: [
                { resref: "SPWI112", flags: 1 },
                { resref: "SPWI112", flags: 1 },
                { resref: "SPWI201", flags: 1 },
            ],
        });
        expect(v.bucket).toHaveLength(0);
        const wiz = v.types.find((t) => t.type === 1)!;
        expect(wiz.typeName).toBe("Wizard");
        const l1 = levelOf(v, 1, 0)!;
        expect(l1.slots.map((s) => s.resref)).toEqual(["SPWI112", "SPWI112"]);
        expect(l1.known.map((k) => k.resref)).toEqual(["SPWI112"]);
        expect(l1.numMemorizableEffective).toBe(3);
        expect(l1.flagged).toBe(false);
        const l2 = levelOf(v, 1, 1)!;
        expect(l2.slots.map((s) => s.resref)).toEqual(["SPWI201"]);
    });

    it("prunes fully-empty levels but keeps levels with open capacity", () => {
        const v = project({
            meminfo: [
                { level: 0, type: 0, numMemorizable: 0, numMemorizableEffective: 0, start: 0, count: 0 }, // empty
                { level: 1, type: 0, numMemorizable: 2, numMemorizableEffective: 2, start: 0, count: 0 }, // open slots
            ],
        });
        expect(levelOf(v, 0, 0)).toBeUndefined();
        expect(levelOf(v, 0, 1)).toBeDefined();
    });

    it("groups types in code order and labels unknown type codes", () => {
        const v = project({
            known: [
                { resref: "X", level: 0, type: 2 },
                { resref: "Y", level: 0, type: 0 },
                { resref: "Z", level: 0, type: 5 },
            ],
        });
        expect(v.types.map((t) => t.type)).toEqual([0, 2, 5]);
        expect(v.types.find((t) => t.type === 5)!.typeName).toBe("Type 5");
    });
});

describe("projectSpellbook - inconsistent data is rendered losslessly", () => {
    it("orphan: a memorized entry covered by no range goes to the bucket", () => {
        const v = project({
            meminfo: [{ level: 0, type: 1, start: 0, count: 2 }],
            memorized: [{ resref: "A" }, { resref: "B" }, { resref: "ORPHAN" }],
        });
        expect(v.bucket).toHaveLength(1);
        expect(v.bucket[0]!.reason).toBe("orphan");
        expect(v.bucket[0]!.resref).toBe("ORPHAN");
        expect(v.bucket[0]!.memorizedIndex).toBe(2);
        // The clean level still shows its two owned slots.
        expect(levelOf(v, 1, 0)!.slots.map((s) => s.resref)).toEqual(["A", "B"]);
    });

    it("contested: an entry claimed by two ranges goes to the bucket and flags both levels", () => {
        const v = project({
            meminfo: [
                { level: 0, type: 1, start: 0, count: 3 }, // claims 0,1,2
                { level: 1, type: 1, start: 2, count: 2 }, // claims 2,3 -> #2 contested
            ],
            memorized: [{ resref: "A" }, { resref: "B" }, { resref: "C" }, { resref: "D" }],
        });
        const contested = v.bucket.find((b) => b.reason === "contested")!;
        expect(contested.memorizedIndex).toBe(2);
        expect(contested.claimedBy).toEqual(["Wizard L1", "Wizard L2"]);
        // Both levels are flagged (ambiguous to structurally edit) and show only their cleanly-owned entries.
        expect(levelOf(v, 1, 0)!.flagged).toBe(true);
        expect(levelOf(v, 1, 0)!.slots.map((s) => s.resref)).toEqual(["A", "B"]);
        expect(levelOf(v, 1, 1)!.flagged).toBe(true);
        expect(levelOf(v, 1, 1)!.slots.map((s) => s.resref)).toEqual(["D"]);
    });

    it("overrun: a range past the table flags the level and shows only its in-bounds entries", () => {
        const v = project({
            meminfo: [{ level: 0, type: 1, start: 0, count: 5 }], // claims 0..4 but only 2 exist
            memorized: [{ resref: "A" }, { resref: "B" }],
        });
        const l = levelOf(v, 1, 0)!;
        expect(l.flagged).toBe(true);
        expect(l.flagReasons.some((r) => /overruns/.test(r))).toBe(true);
        expect(l.slots.map((s) => s.resref)).toEqual(["A", "B"]);
        expect(l.declaredCount).toBe(5);
    });

    it("out-of-bounds start: a range starting past the table flags the level with no slots", () => {
        const v = project({
            meminfo: [{ level: 0, type: 1, start: 9, count: 1 }],
            memorized: [{ resref: "A" }],
        });
        // 'A' at index 0 is claimed by nobody -> orphan; the level is flagged and empty.
        const l = levelOf(v, 1, 0)!;
        expect(l.flagged).toBe(true);
        expect(l.slots).toHaveLength(0);
        expect(v.bucket.some((b) => b.reason === "orphan" && b.resref === "A")).toBe(true);
    });

    it("duplicate (type, level) rows are each flagged and shown", () => {
        const v = project({
            meminfo: [
                { level: 0, type: 1, numMemorizable: 1, start: 0, count: 1 },
                { level: 0, type: 1, numMemorizable: 1, start: 1, count: 1 },
            ],
            memorized: [{ resref: "A" }, { resref: "B" }],
        });
        const wizL1 = v.types.find((t) => t.type === 1)!.levels.filter((l) => l.level === 0);
        expect(wizL1).toHaveLength(2);
        expect(wizL1.every((l) => l.flagged && l.flagReasons.some((r) => /more than one/.test(r)))).toBe(true);
    });

    it("a known spell whose level has no memorization row gets a synthetic panel", () => {
        const v = project({ known: [{ resref: "SPWI901", level: 8, type: 1 }] });
        const l = levelOf(v, 1, 8)!;
        expect(l.known.map((k) => k.resref)).toEqual(["SPWI901"]);
        expect(l.slots).toHaveLength(0);
        expect(l.ownerNodeId).toBeUndefined();
    });

    it("returns an empty view when the file carries no spell tables", () => {
        expect(project({}).empty).toBe(true);
    });
});

// Real-producer guard: drive the actual CRE parser on a vendored fixture so a humanized-label drift (e.g.
// "Spell Type" renamed) fails loudly instead of passing against a wrong assumption. finaluf.CRE is a high-level
// mage with a full, internally-consistent spellbook. Skips when the fixture is absent.
const CRE_FIXTURE = path.resolve(
    __dirname,
    "../../external/infinity-engine/Ascension/ascension/ascensionmain/demon/finaluf.CRE",
);

describe("projectSpellbook against the real CRE parser", () => {
    it("joins a real spellbook with no spurious bucket entries or flags", () => {
        if (!fs.existsSync(CRE_FIXTURE)) return;
        const { sessionId } = openSession("file:///finaluf.cre", new Uint8Array(fs.readFileSync(CRE_FIXTURE)));
        const v = projectSpellbook(sessionStore.get(sessionId)!.model);
        // A real, consistent file: every memorized spell is cleanly owned (no bucket) and no level is flagged.
        expect(v.empty).toBe(false);
        expect(v.bucket).toHaveLength(0);
        const allLevels = v.types.flatMap((t) => t.levels);
        expect(allLevels.some((l) => l.flagged)).toBe(false);
        // The labels resolved: at least one level carries memorized slots and at least one carries known spells.
        expect(allLevels.some((l) => l.slots.length > 0)).toBe(true);
        expect(allLevels.some((l) => l.known.length > 0)).toBe(true);
        // Wizard spells are present (the parser exposed the enum type code we key on).
        expect(v.types.some((t) => t.typeName === "Wizard")).toBe(true);
    });
});
