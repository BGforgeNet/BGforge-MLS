import { describe, expect, it } from "vitest";
import { splitForm, organizeGroups } from "../../../src/binary-editor/webview/state/form-groups";

const field = (id: string) => ({ id, kind: "field", name: id }) as any;
const group = (id: string) => ({ id, kind: "group", name: id }) as any;

describe("form-groups", () => {
    it("splits ungrouped fields from groups, preserving order", () => {
        const r = splitForm([field("a"), group("g1"), field("b"), group("g2")]);
        expect(r.fields.map((f) => f.id)).toEqual(["a", "b"]);
        expect(r.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
    });
    it("0-1 groups render as sections", () => {
        expect(organizeGroups([group("g")], 1, 6).mode).toBe("sections");
        expect(organizeGroups([], 1, 6).mode).toBe("sections");
    });
    it("2..threshold groups render as tabs, alternating orientation by depth", () => {
        const g = [group("a"), group("b")];
        // depth 1 (first level inside the form, under the horizontal section tabs) -> vertical
        expect(organizeGroups(g, 1, 6)).toEqual({ mode: "tabs", orientation: "vertical" });
        // depth 2 -> horizontal
        expect(organizeGroups(g, 2, 6)).toEqual({ mode: "tabs", orientation: "horizontal" });
    });
    it("over threshold falls back to sections", () => {
        const many = Array.from({ length: 7 }, (_, i) => group(`g${i}`));
        expect(organizeGroups(many, 1, 6).mode).toBe("sections");
        expect(
            organizeGroups(
                Array.from({ length: 6 }, (_, i) => group(`g${i}`)),
                1,
                6,
            ).mode,
        ).toBe("tabs");
    });
});
