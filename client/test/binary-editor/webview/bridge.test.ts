import { describe, expect, it } from "vitest";
import { Bridge } from "../../../src/binary-editor/webview/state/bridge";

describe("Bridge", () => {
    it("correlates a children response to its requestChildren by requestId, and caches it", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));
        const p = bridge.requestChildren("p", 0, 10);
        bridge.handle({ type: "children", requestId: sent[0].requestId, parentId: "p", rows: [], total: 3 });
        await expect(p).resolves.toEqual({ rows: [], total: 3 });

        // Second identical request resolves from cache without posting another message.
        const cached = await bridge.requestChildren("p", 0, 10);
        expect(cached).toEqual({ rows: [], total: 3 });
        expect(sent).toHaveLength(1);
    });

    it("re-posts after invalidate()", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));
        const p = bridge.requestChildren("p", 0, 10);
        bridge.handle({ type: "children", requestId: sent[0].requestId, parentId: "p", rows: [], total: 1 });
        await p;
        bridge.invalidate();
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
});
