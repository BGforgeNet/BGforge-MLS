import { describe, expect, it } from "vitest";
import { splitForm } from "../../../src/binary-editor/webview/state/form-groups";

const field = (id: string) => ({ id, kind: "field", name: id }) as any;
const group = (id: string) => ({ id, kind: "group", name: id }) as any;

describe("form-groups", () => {
    it("splits ungrouped fields from groups, preserving order", () => {
        const r = splitForm([field("a"), group("g1"), field("b"), group("g2")]);
        expect(r.fields.map((f) => f.id)).toEqual(["a", "b"]);
        expect(r.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
    });

    it("returns empty arrays for empty input", () => {
        const r = splitForm([]);
        expect(r.fields).toEqual([]);
        expect(r.groups).toEqual([]);
    });

    it("returns only fields when there are no groups", () => {
        const r = splitForm([field("x"), field("y")]);
        expect(r.fields.map((f) => f.id)).toEqual(["x", "y"]);
        expect(r.groups).toEqual([]);
    });

    it("returns only groups when there are no fields", () => {
        const r = splitForm([group("g1"), group("g2")]);
        expect(r.fields).toEqual([]);
        expect(r.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
    });
});
