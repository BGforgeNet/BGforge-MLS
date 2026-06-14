import { describe, expect, it, vi } from "vitest";
import { Bridge } from "../../../src/binary-editor/webview/state/bridge";

describe("Bridge", () => {
    it("correlates a children response to its requestChildren by requestId", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));
        const p = bridge.requestChildren("p", 0, 10);
        bridge.handle({ type: "children", requestId: sent[0].requestId, parentId: "p", rows: [], total: 3 });
        await expect(p).resolves.toEqual({ rows: [], total: 3 });
    });

    it("re-posts on every request (uncached, so each reflects current state)", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));
        const p = bridge.requestChildren("p", 0, 10);
        bridge.handle({ type: "children", requestId: sent[0].requestId, parentId: "p", rows: [], total: 1 });
        await p;
        void bridge.requestChildren("p", 0, 10);
        expect(sent).toHaveLength(2);
    });

    it("rejects the pending request on a matching error", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));
        const p = bridge.requestChildren(null, 0, 10);
        bridge.handle({ type: "error", requestId: sent[0].requestId, message: "boom" });
        await expect(p).rejects.toThrow("boom");
    });

    it("surfaces an error with no matching pending request via onUnhandledError", () => {
        const bridge = new Bridge(() => {});
        const onErr = vi.fn();
        bridge.onUnhandledError = onErr;
        // An editField/structureOp/spellbookEdit failure carries no requestId.
        expect(bridge.handle({ type: "error", message: "edit failed" })).toBe(true);
        // A requestId that matches no live request (e.g. a stale response after invalidation).
        expect(bridge.handle({ type: "error", requestId: 999, message: "stale" })).toBe(true);
        expect(onErr.mock.calls).toEqual([["edit failed"], ["stale"]]);
    });

    it("posts editField/structureOp/dumpJson/loadJson messages verbatim", () => {
        const sent: unknown[] = [];
        const bridge = new Bridge((m) => sent.push(m));
        bridge.editField("0/1", 7);
        bridge.structureOp({ op: "add", sectionId: "Global Variables" });
        bridge.dumpJson();
        bridge.loadJson();
        expect(sent).toEqual([
            { type: "editField", nodeId: "0/1", value: 7 },
            { type: "structureOp", op: { op: "add", sectionId: "Global Variables" } },
            { type: "dumpJson" },
            { type: "loadJson" },
        ]);
    });
});
