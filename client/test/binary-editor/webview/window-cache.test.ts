import { describe, expect, it } from "vitest";
import type { Row } from "@bgforge/binary-editor";
import { WindowCache } from "../../../src/binary-editor/webview/state/window-cache";

function row(id: string): Row {
    return { id, namePath: [id], depth: 1, kind: "field", name: id };
}

describe("WindowCache", () => {
    it("stores and resolves a child window by (parentId,start,end)", () => {
        const c = new WindowCache();
        expect(c.get("p", 0, 2)).toBeUndefined();
        c.put("p", 0, 2, { rows: [row("a"), row("b")], total: 5 });
        expect(c.get("p", 0, 2)?.rows.map((r) => r.id)).toEqual(["a", "b"]);
        expect(c.totalFor("p")).toBe(5);
    });

    it("distinguishes windows by range and parent (roots use null)", () => {
        const c = new WindowCache();
        c.put(null, 0, 2, { rows: [row("r")], total: 1 });
        expect(c.get(null, 0, 2)?.rows[0].id).toBe("r");
        expect(c.get("p", 0, 2)).toBeUndefined();
    });

    it("clear() empties everything (used on mutation/invalidated)", () => {
        const c = new WindowCache();
        c.put("p", 0, 2, { rows: [row("a")], total: 1 });
        c.clear();
        expect(c.get("p", 0, 2)).toBeUndefined();
        expect(c.totalFor("p")).toBeUndefined();
    });
});
