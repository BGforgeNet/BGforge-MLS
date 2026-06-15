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
});
