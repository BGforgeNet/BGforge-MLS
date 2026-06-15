import { describe, expect, it } from "vitest";
import type { HostToWebview, WebviewToHost } from "../../../src/binary-editor/webview/messages";

describe("message contract", () => {
    it("permits the Plan 3 webview->host messages", () => {
        const msgs: WebviewToHost[] = [
            { type: "ready" },
            { type: "requestChildren", requestId: 1, nodeId: null, start: 0, end: 50 },
            { type: "requestChildren", requestId: 2, nodeId: "0/1", start: 0, end: 50 },
            { type: "editField", nodeId: "0/1/2", value: 7 },
            { type: "structureOp", op: { op: "add", sectionId: "0" } },
            { type: "dumpJson" },
            { type: "loadJson" },
        ];
        expect(msgs).toHaveLength(7);
        expect(msgs.map((m) => m.type)).toEqual([
            "ready",
            "requestChildren",
            "requestChildren",
            "editField",
            "structureOp",
            "dumpJson",
            "loadJson",
        ]);
        // requestChildren with a null nodeId (root) and a string nodeId (child)
        expect((msgs[1] as { requestId: number }).requestId).toBe(1);
        expect((msgs[2] as { nodeId: string | null }).nodeId).toBe("0/1");
    });

    it("permits the Plan 3 host->webview messages", () => {
        const msgs: HostToWebview[] = [
            {
                type: "init",
                open: {
                    sessionId: "s1",
                    format: "map",
                    formatName: "MAP",
                    layout: { formatId: "map" },
                    warnings: [],
                    errors: [],
                    rootWindow: [],
                },
            },
            { type: "children", requestId: 1, parentId: null, rows: [], total: 0 },
            { type: "changeSet", changeSet: { changed: [], diagnostics: [], dirty: true, formatValid: true } },
            // changeSet carries an optional post-op selection NodeId for the view to re-activate (Plan 5).
            {
                type: "changeSet",
                changeSet: { changed: [], diagnostics: [], dirty: true, formatValid: true },
                selection: "0/1",
            },
            { type: "invalidated" },
            { type: "diagnostics", diagnostics: [] },
            { type: "error", message: "boom" },
        ];
        expect(msgs).toHaveLength(7);
        expect(msgs.map((m) => m.type)).toEqual([
            "init",
            "children",
            "changeSet",
            "changeSet",
            "invalidated",
            "diagnostics",
            "error",
        ]);
        // changeSet with selection pin (Plan 5 addition)
        expect((msgs[3] as { selection?: string }).selection).toBe("0/1");
        // error message is surfaced
        expect((msgs[6] as { type: "error"; message: string }).message).toBe("boom");
    });
});
