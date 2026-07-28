import { describe, expect, it, vi } from "vitest";
import { withGameContext } from "../../src/binary-editor/game-rows";

const LINE = "Ring of Protection +1";
const lookups = {
    strref: (strref: number): string | undefined => (strref === 6348 ? LINE : undefined),
    slotLabel: (): string | undefined => undefined,
};

const strrefRow = { id: "f1", kind: "field", name: "Unidentified Name", strref: true, rawValue: 6348 };
const plainRow = { id: "f2", kind: "field", name: "Weight", rawValue: 37 };

describe("withGameContext", () => {
    it("fills strrefText on a strref row nested in a message", () => {
        const message = { type: "children", requestId: 3, rows: [plainRow, strrefRow] };

        const out = withGameContext(message, lookups);

        expect(out.rows[1]).toMatchObject({ id: "f1", rawValue: 6348, strrefText: LINE });
        expect(out.rows[0]).not.toHaveProperty("strrefText");
    });

    it("reaches rows at any depth, so a new row-bearing message shape needs no change here", () => {
        const message = { type: "init", open: { rootWindow: [{ kind: "group", children: [strrefRow] }] } };

        const out = withGameContext(message, lookups);

        expect(out.open.rootWindow[0]?.children[0]).toHaveProperty("strrefText", LINE);
    });

    it("leaves a strref the TLK cannot resolve untouched", () => {
        const out = withGameContext({ rows: [{ ...strrefRow, rawValue: 999 }] }, lookups);

        expect(out.rows[0]).not.toHaveProperty("strrefText");
    });

    // Structural sharing is what keeps this affordable at the post choke point: a record with no game behind it
    // resolves nothing, and must not pay a deep clone of every message.
    it("returns the identical object when nothing resolved", () => {
        const message = { type: "children", rows: [plainRow, { ...strrefRow, rawValue: 999 }] };

        expect(withGameContext(message, lookups)).toBe(message);
    });

    it("shares the untouched branches of a message it did change", () => {
        const untouched = { deep: { rows: [plainRow] } };
        const message = { untouched, changed: [strrefRow] };

        const out = withGameContext(message, lookups);

        expect(out).not.toBe(message);
        expect(out.untouched).toBe(untouched);
    });

    it("does not re-resolve a row that already carries text", () => {
        const spy = vi.fn(lookups.strref);

        withGameContext({ rows: [{ ...strrefRow, strrefText: "already there" }] }, { ...lookups, strref: spy });

        expect(spy).not.toHaveBeenCalled();
    });

    // A slot named by the game's own IDS table (a CRE sound slot): the parser emits which tables name it and
    // at which index, and the host - which holds the game - turns that into the row's label.
    it("names an IDS-backed slot from the game's table", () => {
        const slotRow = { id: "s1", kind: "field", name: "Sound 22", idsSlot: { tables: ["SNDSLOT"], index: 21 } };
        const named = {
            ...lookups,
            slotLabel: (tables: readonly string[], index: number) =>
                tables[0] === "SNDSLOT" && index === 21 ? "AREA_FOREST" : undefined,
        };

        const out = withGameContext({ rows: [slotRow] }, named);

        expect(out.rows[0]).toMatchObject({ id: "s1", name: "22 AREA_FOREST" });
    });

    it("keeps the generic slot label when the game has no name for it", () => {
        const slotRow = { id: "s2", kind: "field", name: "Sound 90", idsSlot: { tables: ["SNDSLOT"], index: 89 } };

        const out = withGameContext({ rows: [slotRow] }, lookups);

        expect(out.rows[0]).toMatchObject({ name: "Sound 90" });
    });

    // A CRE sound slot is BOTH: a strref (the line it points at) and an IDS-named slot (its label). The real
    // row carries both, so filling one must not skip the other.
    it("fills the line AND the slot name on a row that is both", () => {
        const soundSlot = {
            id: "s3",
            kind: "field",
            name: "Sound 22",
            strref: true,
            rawValue: 6348,
            idsSlot: { tables: ["SNDSLOT"], index: 21 },
        };
        const named = { ...lookups, slotLabel: () => "AREA_FOREST" };

        const out = withGameContext({ rows: [soundSlot] }, named);

        expect(out.rows[0]).toMatchObject({ name: "22 AREA_FOREST", strrefText: LINE });
    });
});
