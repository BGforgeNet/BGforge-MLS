/**
 * Unit tests for SSL dialog tree builder.
 * Tests pure HTML generation functions: getMsgTextRaw, getMsgText,
 * getOptionMeta, buildTreeHtml.
 */

import { vi, describe, expect, it } from "vitest";

vi.mock("vscode", () => ({}));
vi.mock("vscode-languageclient/node", () => ({}));

import {
    getMsgTextRaw,
    getMsgText,
    getOptionMeta,
    buildTreeHtml,
    type DialogData,
    type DialogOption,
} from "../src/dialog-tree/dialogTree";

// ---------------------------------------------------------------------------
// getMsgTextRaw
// ---------------------------------------------------------------------------

describe("getMsgTextRaw", () => {
    const messages: Record<string, string> = { "100": "Hello world", "200": "Goodbye" };

    it("resolves numeric msgId to message text", () => {
        expect(getMsgTextRaw(100, messages)).toBe("Hello world");
    });

    it("returns fallback for unknown numeric msgId", () => {
        expect(getMsgTextRaw(999, messages)).toBe("(999)");
    });

    it("returns string msgId as-is", () => {
        expect(getMsgTextRaw("inline text", messages)).toBe("inline text");
    });

    it("returns string with HTML chars as-is (raw, not escaped)", () => {
        expect(getMsgTextRaw('<script>"xss"</script>', messages)).toBe('<script>"xss"</script>');
    });
});

// ---------------------------------------------------------------------------
// getMsgText
// ---------------------------------------------------------------------------

describe("getMsgText", () => {
    const messages: Record<string, string> = { "100": 'He said "hi" & waved' };

    it("returns escaped text for numeric msgId", () => {
        expect(getMsgText(100, messages)).toBe("He said &quot;hi&quot; &amp; waved");
    });

    it("escapes string msgId", () => {
        expect(getMsgText("<b>bold</b>", {})).toBe("&lt;b&gt;bold&lt;/b&gt;");
    });

    it("escapes fallback for unknown msgId", () => {
        expect(getMsgText(999, {})).toBe("(999)");
    });
});

// ---------------------------------------------------------------------------
// getOptionMeta
// ---------------------------------------------------------------------------

describe("getOptionMeta", () => {
    function makeOption(type: string, msgId: number | string = 100, target = "Node001"): DialogOption {
        return { type, msgId, target, line: 1 };
    }

    it("returns option-good for G-prefixed types", () => {
        const meta = getOptionMeta(makeOption("GOption"));
        expect(meta.colorClass).toBe("option-good");
    });

    it("returns option-bad for B-prefixed types", () => {
        const meta = getOptionMeta(makeOption("BOption"));
        expect(meta.colorClass).toBe("option-bad");
    });

    it("returns option-neutral for N-prefixed types", () => {
        const meta = getOptionMeta(makeOption("NOption"));
        expect(meta.colorClass).toBe("option-neutral");
    });

    it("returns stop-circle icon for message types", () => {
        const meta = getOptionMeta(makeOption("NMessage"));
        expect(meta.icon).toBe("stop-circle");
    });

    it("returns arrow-right icon for non-message types", () => {
        const meta = getOptionMeta(makeOption("NOption"));
        expect(meta.icon).toBe("arrow-right");
    });

    it("includes low emoji for Low types", () => {
        const meta = getOptionMeta(makeOption("NLowOption"));
        expect(meta.lowEmoji).toContain("🤪");
    });

    it("has empty lowEmoji for non-Low types", () => {
        const meta = getOptionMeta(makeOption("NOption"));
        expect(meta.lowEmoji).toBe("");
    });

    it("escapes tooltip", () => {
        const meta = getOptionMeta(makeOption("GOption", 'a"b'));
        expect(meta.tooltip).toContain("&quot;");
    });
});

// ---------------------------------------------------------------------------
// buildTreeHtml
// ---------------------------------------------------------------------------

describe("buildTreeHtml", () => {
    it("returns 'no data' message for empty nodes", () => {
        const data: DialogData = { nodes: [], entryPoints: [], messages: {} };
        expect(buildTreeHtml(data)).toContain("No dialog nodes found");
    });

    it("renders a simple dialog node", () => {
        const data: DialogData = {
            nodes: [
                {
                    name: "Node001",
                    line: 1,
                    replies: [{ msgId: 100, line: 2 }],
                    options: [{ msgId: 200, target: "", type: "NMessage", line: 3 }],
                    callTargets: [],
                },
            ],
            entryPoints: ["Node001"],
            messages: { "100": "Hello there", "200": "Goodbye" },
        };
        const html = buildTreeHtml(data);
        expect(html).toContain("Node001");
        expect(html).toContain("Hello there");
        expect(html).toContain("Goodbye");
        expect(html).toContain("talk_p_proc");
    });

    it("escapes HTML in message text", () => {
        const data: DialogData = {
            nodes: [
                {
                    name: "Node001",
                    line: 1,
                    replies: [{ msgId: "inline <script>alert(1)</script>", line: 2 }],
                    options: [],
                    callTargets: [],
                },
            ],
            entryPoints: ["Node001"],
            messages: {},
        };
        const html = buildTreeHtml(data);
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
    });

    it("escapes data-fulltext attributes", () => {
        const data: DialogData = {
            nodes: [
                {
                    name: "Node001",
                    line: 1,
                    replies: [{ msgId: 100, line: 2 }],
                    options: [],
                    callTargets: [],
                },
            ],
            entryPoints: ["Node001"],
            messages: { "100": 'She said "hello" & waved' },
        };
        const html = buildTreeHtml(data);
        // data-fulltext should have escaped quotes and ampersands
        expect(html).toContain("&amp;");
        expect(html).toContain("&quot;");
    });

    it("renders linked nodes for goto targets", () => {
        const data: DialogData = {
            nodes: [
                {
                    name: "Node001",
                    line: 1,
                    replies: [],
                    options: [{ msgId: 100, target: "Node002", type: "NOption", line: 2 }],
                    callTargets: [],
                },
                {
                    name: "Node002",
                    line: 5,
                    replies: [{ msgId: 200, line: 6 }],
                    options: [],
                    callTargets: [],
                },
            ],
            entryPoints: ["Node001"],
            messages: { "100": "Go to node 2", "200": "You arrived" },
        };
        const html = buildTreeHtml(data);
        expect(html).toContain("Node001");
        expect(html).toContain("Node002");
        expect(html).toContain("You arrived");
    });

    it("renders link back to already-rendered node", () => {
        const data: DialogData = {
            nodes: [
                {
                    name: "Node001",
                    line: 1,
                    replies: [],
                    options: [{ msgId: 100, target: "Node002", type: "NOption", line: 2 }],
                    callTargets: [],
                },
                {
                    name: "Node002",
                    line: 5,
                    replies: [],
                    options: [{ msgId: 200, target: "Node001", type: "NOption", line: 6 }],
                    callTargets: [],
                },
            ],
            entryPoints: ["Node001"],
            messages: { "100": "Forward", "200": "Back" },
        };
        const html = buildTreeHtml(data);
        // Node002's transition back to Node001 renders as a node-link
        expect(html).toContain('data-target="Node001"');
        // Both nodes should appear
        expect(html).toContain("Node001");
        expect(html).toContain("Node002");
    });
});
