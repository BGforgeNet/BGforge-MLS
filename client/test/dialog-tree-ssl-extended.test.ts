/**
 * Extended unit tests for SSL dialog tree builder (dialogTree.ts).
 * Covers uncovered branches: multiple replies (remaining replies list),
 * call-targets-only node rendering, options without targets,
 * deep node linking (shouldRenderChild=false because already rendered),
 * unknown-target options.
 */

import { vi, describe, expect, it } from "vitest";

vi.mock("vscode", () => ({}));
vi.mock("vscode-languageclient/node", () => ({}));

import { buildTreeHtml, type DialogData, type DialogNode } from "../src/dialog-tree/dialogTree";

function node(overrides: Partial<DialogNode>): DialogNode {
    return {
        name: "Node001",
        line: 1,
        replies: [],
        options: [],
        callTargets: [],
        ...overrides,
    };
}

describe("buildTreeHtml - remaining reply rendering", () => {
    it("renders multiple replies where first is inline and rest are listed", () => {
        // Lines 177-184: replies.slice(skipFirstReply ? 1 : 0)
        const data: DialogData = {
            nodes: [
                node({
                    name: "Node001",
                    replies: [
                        { msgId: 100, line: 2 },
                        { msgId: 200, line: 3 }, // second reply should appear in the list
                    ],
                    options: [],
                }),
            ],
            entryPoints: ["Node001"],
            messages: { "100": "First reply", "200": "Second reply" },
        };
        const html = buildTreeHtml(data);
        expect(html).toContain("First reply");
        expect(html).toContain("Second reply");
    });

    it("renders node with call targets only (no replies, no options)", () => {
        // Lines 138-147: callTargets branch — shows inline transition node
        const data: DialogData = {
            nodes: [
                node({ name: "Node001", callTargets: ["Node002"] }),
                node({ name: "Node002", replies: [{ msgId: 100, line: 2 }], options: [] }),
            ],
            entryPoints: ["Node001"],
            messages: { "100": "Called node reply" },
        };
        const html = buildTreeHtml(data);
        expect(html).toContain("Node001");
        expect(html).toContain("Node002");
    });

    it("renders call target that is not in nodeMap as plain span (not a link)", () => {
        // Lines 142-144: targetNode undefined branch in callTargets rendering
        const data: DialogData = {
            nodes: [node({ name: "Node001", callTargets: ["UnknownTarget"] })],
            entryPoints: ["Node001"],
            messages: {},
        };
        const html = buildTreeHtml(data);
        expect(html).toContain("UnknownTarget");
        // No node-link for unknown target
        expect(html).not.toContain(`data-target="UnknownTarget"`);
    });
});

describe("buildTreeHtml - terminal option inline rendering", () => {
    it("renders option without target as terminal message inline in node header", () => {
        // Lines 163-173: terminalIdx !== -1 branch
        const data: DialogData = {
            nodes: [
                node({
                    name: "Node001",
                    replies: [],
                    options: [{ msgId: 100, target: "", type: "NMessage", line: 2 }],
                }),
            ],
            entryPoints: ["Node001"],
            messages: { "100": "Terminal message" },
        };
        const html = buildTreeHtml(data);
        expect(html).toContain("Terminal message");
    });
});

describe("buildTreeHtml - option target rendering variants", () => {
    it("renders option pointing to unknown (non-existent) target as span, not link", () => {
        // Lines 200-202: targetNode undefined, renders as span
        const data: DialogData = {
            nodes: [
                node({
                    name: "Node001",
                    replies: [],
                    options: [{ msgId: 100, target: "GhostNode", type: "NOption", line: 2 }],
                }),
            ],
            entryPoints: ["Node001"],
            messages: { "100": "Go to ghost" },
        };
        const html = buildTreeHtml(data);
        expect(html).toContain("GhostNode");
        // Should be a <span>, not a node-link anchor
        expect(html).not.toContain(`data-target="GhostNode"`);
    });

    it("renders node with no children (no replies, no options) as single inline line", () => {
        // Line 224-226: !children branch — node-inline div
        const data: DialogData = {
            nodes: [
                node({
                    name: "Node001",
                    replies: [],
                    options: [],
                }),
            ],
            entryPoints: ["Node001"],
            messages: {},
        };
        const html = buildTreeHtml(data);
        expect(html).toContain("node-inline");
        expect(html).toContain("Node001");
    });

    it("renders option where shouldRenderChild=false (target already rendered)", () => {
        // Lines 211-213: shouldRenderChild false — renders as link only (no child expansion)
        const data: DialogData = {
            nodes: [
                node({
                    name: "Node001",
                    options: [
                        { msgId: 100, target: "Node002", type: "NOption", line: 2 },
                        // second option pointing back to Node002 (already rendered)
                        { msgId: 101, target: "Node002", type: "NOption", line: 3 },
                    ],
                }),
                node({
                    name: "Node002",
                    replies: [{ msgId: 200, line: 4 }],
                }),
            ],
            entryPoints: ["Node001"],
            messages: { "100": "First", "101": "Again", "200": "Target reply" },
        };
        const html = buildTreeHtml(data);
        expect(html).toContain("Node002");
        expect(html).toContain("Target reply");
    });
});

describe("buildTreeHtml - cycle detection in computeDepths", () => {
    it("handles cyclic option references without infinite recursion", () => {
        // Lines 93/116: cycle detection path.has(nodeName) and path.delete
        const data: DialogData = {
            nodes: [
                node({ name: "Node001", options: [{ msgId: 100, target: "Node002", type: "NOption", line: 2 }] }),
                node({ name: "Node002", options: [{ msgId: 200, target: "Node001", type: "NOption", line: 4 }] }),
            ],
            entryPoints: ["Node001"],
            messages: { "100": "Fwd", "200": "Back" },
        };
        // Should not throw or infinite-loop
        expect(() => buildTreeHtml(data)).not.toThrow();
        const html = buildTreeHtml(data);
        expect(html).toContain("Node001");
        expect(html).toContain("Node002");
    });
});
