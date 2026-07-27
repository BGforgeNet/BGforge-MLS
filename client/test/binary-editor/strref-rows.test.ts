import { describe, expect, it, vi } from "vitest";
import { withResolvedStrrefs } from "../../src/binary-editor/strref-rows";

const LINE = "Ring of Protection +1";
const resolve = (strref: number): string | undefined => (strref === 6348 ? LINE : undefined);

const strrefRow = { id: "f1", kind: "field", name: "Unidentified Name", strref: true, rawValue: 6348 };
const plainRow = { id: "f2", kind: "field", name: "Weight", rawValue: 37 };

describe("withResolvedStrrefs", () => {
    it("fills strrefText on a strref row nested in a message", () => {
        const message = { type: "children", requestId: 3, rows: [plainRow, strrefRow] };

        const out = withResolvedStrrefs(message, resolve);

        expect(out.rows[1]).toMatchObject({ id: "f1", rawValue: 6348, strrefText: LINE });
        expect(out.rows[0]).not.toHaveProperty("strrefText");
    });

    it("reaches rows at any depth, so a new row-bearing message shape needs no change here", () => {
        const message = { type: "init", open: { rootWindow: [{ kind: "group", children: [strrefRow] }] } };

        const out = withResolvedStrrefs(message, resolve);

        expect(out.open.rootWindow[0]?.children[0]).toHaveProperty("strrefText", LINE);
    });

    it("leaves a strref the TLK cannot resolve untouched", () => {
        const out = withResolvedStrrefs({ rows: [{ ...strrefRow, rawValue: 999 }] }, resolve);

        expect(out.rows[0]).not.toHaveProperty("strrefText");
    });

    // Structural sharing is what keeps this affordable at the post choke point: a record with no game behind it
    // resolves nothing, and must not pay a deep clone of every message.
    it("returns the identical object when nothing resolved", () => {
        const message = { type: "children", rows: [plainRow, { ...strrefRow, rawValue: 999 }] };

        expect(withResolvedStrrefs(message, resolve)).toBe(message);
    });

    it("shares the untouched branches of a message it did change", () => {
        const untouched = { deep: { rows: [plainRow] } };
        const message = { untouched, changed: [strrefRow] };

        const out = withResolvedStrrefs(message, resolve);

        expect(out).not.toBe(message);
        expect(out.untouched).toBe(untouched);
    });

    it("does not re-resolve a row that already carries text", () => {
        const spy = vi.fn(resolve);

        withResolvedStrrefs({ rows: [{ ...strrefRow, strrefText: "already there" }] }, spy);

        expect(spy).not.toHaveBeenCalled();
    });
});
