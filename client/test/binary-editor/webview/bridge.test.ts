import { describe, expect, it, vi } from "vitest";
import type { EffectTreeView, SpellbookView } from "@bgforge/binary-editor";
import { Bridge } from "../../../src/binary-editor/webview/state/bridge";

describe("Bridge", () => {
    it("correlates a children response to its requestChildren by requestId", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));
        const p = bridge.requestChildren("p", 0, 10);
        bridge.handle({ type: "children", requestId: sent[0]!.requestId, parentId: "p", rows: [], total: 3 });
        await expect(p).resolves.toEqual({ rows: [], total: 3 });
    });

    it("re-posts on every request (uncached, so each reflects current state)", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));
        const p = bridge.requestChildren("p", 0, 10);
        bridge.handle({ type: "children", requestId: sent[0]!.requestId, parentId: "p", rows: [], total: 1 });
        await p;
        void bridge.requestChildren("p", 0, 10);
        expect(sent).toHaveLength(2);
    });

    it("rejects the pending request on a matching error", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));
        const p = bridge.requestChildren(null, 0, 10);
        bridge.handle({ type: "error", requestId: sent[0]!.requestId, message: "boom" });
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

    it("posts editField/structureOp/spellbookEdit/dumpJson/loadJson messages verbatim", () => {
        const sent: unknown[] = [];
        const bridge = new Bridge((m) => sent.push(m));
        bridge.editField("0/1", 7);
        bridge.structureOp({ op: "add", sectionId: "Global Variables" });
        bridge.spellbookEdit({ op: "addLevel", spellType: 1, spellLevel: 2 });
        bridge.dumpJson();
        bridge.loadJson();
        expect(sent).toEqual([
            { type: "editField", nodeId: "0/1", value: 7 },
            { type: "structureOp", op: { op: "add", sectionId: "Global Variables" } },
            { type: "spellbookEdit", op: { op: "addLevel", spellType: 1, spellLevel: 2 } },
            { type: "dumpJson" },
            { type: "loadJson" },
        ]);
    });

    it("correlates a spellbook response to its requestSpellbook by requestId", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));
        const p = bridge.requestSpellbook();
        const view: SpellbookView = { types: [], bucket: [], empty: true };
        expect(bridge.handle({ type: "spellbook", requestId: sent[0]!.requestId, view })).toBe(true);
        await expect(p).resolves.toBe(view);
    });

    it("rejects a pending spellbook request on a matching error", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));
        const p = bridge.requestSpellbook();
        expect(bridge.handle({ type: "error", requestId: sent[0]!.requestId, message: "spell boom" })).toBe(true);
        await expect(p).rejects.toThrow("spell boom");
    });

    it("correlates an effectTree response to its requestEffectTree by requestId", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));
        const p = bridge.requestEffectTree();
        const view: EffectTreeView = { groups: [], unassigned: [], empty: true, abilityCount: 0, effectCount: 0 };
        expect(bridge.handle({ type: "effectTree", requestId: sent[0]!.requestId, view })).toBe(true);
        await expect(p).resolves.toBe(view);
    });

    it("rejects a pending effectTree request on a matching error", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));
        const p = bridge.requestEffectTree();
        expect(bridge.handle({ type: "error", requestId: sent[0]!.requestId, message: "tree boom" })).toBe(true);
        await expect(p).rejects.toThrow("tree boom");
    });

    it("ignores a response whose type is none the bridge correlates (returns false)", () => {
        // handle() returns false for any message that resolves no pending query, so the view's own
        // message dispatch keeps handling it.
        const bridge = new Bridge(() => {});
        expect(bridge.handle({ type: "invalidated" })).toBe(false);
    });
});

// The open-a-referenced-resource affordance is fire-and-forget: the host opens an editor, there is nothing to
// correlate back, so this only has to reach the host as a well-formed message.
describe("Bridge.openResource", () => {
    it("posts the resref and the resolved type", () => {
        const sent: unknown[] = [];
        const bridge = new Bridge((m) => sent.push(m));

        bridge.openResource("SPWI112C", "BAM");

        expect(sent).toEqual([{ type: "openResource", resref: "SPWI112C", ext: "BAM" }]);
    });
});

/**
 * The resource list backs a resref field's picker. Unlike every other query it is CACHED per type, because the
 * lists are large (~14700 BAMs in a plain BG:EE) and are not derived from the record, so a mutation cannot
 * stale them.
 */
describe("Bridge.requestResourceList", () => {
    it("correlates a resourceList response to its request by requestId", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));

        const p = bridge.requestResourceList("BAM");
        bridge.handle({ type: "resourceList", requestId: sent[0]!.requestId, resrefs: ["ISW1H01", "ISW1H02"] });

        await expect(p).resolves.toEqual(["ISW1H01", "ISW1H02"]);
        expect(sent[0]).toMatchObject({ type: "requestResourceList", ext: "BAM" });
    });

    it("asks the host once per type and serves later callers from the cache", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));

        const first = bridge.requestResourceList("BAM");
        const second = bridge.requestResourceList("BAM");
        bridge.handle({ type: "resourceList", requestId: sent[0]!.requestId, resrefs: ["ISW1H01"] });

        expect(sent).toHaveLength(1);
        await expect(first).resolves.toEqual(["ISW1H01"]);
        await expect(second).resolves.toEqual(["ISW1H01"]);
        // A different type is a different list, so it is a second request.
        void bridge.requestResourceList("ITM");
        expect(sent).toHaveLength(2);
    });

    it("drops a failed request from the cache so a later open retries", async () => {
        const sent: { requestId: number }[] = [];
        const bridge = new Bridge((m) => sent.push(m as { requestId: number }));

        const first = bridge.requestResourceList("BAM");
        bridge.handle({ type: "error", requestId: sent[0]!.requestId, message: "no game" });
        await expect(first).rejects.toThrow("no game");
        // Without the cache eviction this would replay the rejection forever instead of asking again.
        await Promise.resolve();
        void bridge.requestResourceList("BAM");

        expect(sent).toHaveLength(2);
    });

    it("leaves a resourceList for no live request unhandled rather than throwing", () => {
        const bridge = new Bridge(() => {});
        expect(bridge.handle({ type: "resourceList", requestId: 999, resrefs: [] })).toBe(false);
    });
});
