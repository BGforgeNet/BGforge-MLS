import { describe, expect, it } from "vitest";
import type { HostToWebview, WebviewToHost } from "../../../src/binary-editor/webview/messages";

describe("message contract", () => {
    it("permits the Plan 3 webview->host messages", () => {
        const msgs: WebviewToHost[] = [
            { type: "ready" },
            { type: "requestChildren", requestId: 1, nodeId: null, start: 0, end: 50 },
            { type: "requestChildren", requestId: 2, nodeId: "0/1", start: 0, end: 50 },
            { type: "editField", nodeId: "0/1/2", value: 7 },
            { type: "structureOp", op: { op: "add", namePath: ["Global Variables"] } },
            { type: "dumpJson" },
            { type: "loadJson" },
        ];
        expect(msgs).toHaveLength(7);
    });

    it("permits the Plan 3 host->webview messages", () => {
        const msgs: HostToWebview[] = [
            {
                type: "init",
                open: {
                    sessionId: "s1",
                    format: "map",
                    formatName: "MAP",
                    layout: { formatId: "map", sections: [] },
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
    });
});
