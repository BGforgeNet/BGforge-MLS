/**
 * Unit tests for D dialog tree builder.
 * Tests pure HTML generation functions: getResolvedText, getTransitionText,
 * renderTargetHtml, buildDTreeHtml, getBlockStates.
 */

import { vi, describe, expect, it } from "vitest";

vi.mock("vscode", () => ({}));
vi.mock("vscode-languageclient/node", () => ({}));

import {
    getResolvedText,
    getTransitionText,
    renderTargetHtml,
    buildDTreeHtml,
    getBlockStates,
} from "../src/dialog-tree/dialogTree-d";
import type {
    DDialogData,
    DDialogState,
    DDialogBlock,
    DDialogTransition,
    DDialogTarget,
} from "../../shared/dialog-types";

// ---------------------------------------------------------------------------
// getResolvedText
// ---------------------------------------------------------------------------

describe("getResolvedText", () => {
    const messages: Record<string, string> = { "100": "Hello world", "200": "Goodbye" };

    it("resolves @NNN tra ref to message text", () => {
        expect(getResolvedText("@100", messages)).toBe("Hello world");
    });

    it("returns raw text for unresolved tra ref", () => {
        expect(getResolvedText("@999", messages)).toBe("@999");
    });

    it("returns non-ref text as-is", () => {
        expect(getResolvedText("plain text", messages)).toBe("plain text");
    });

    it("returns tilde string as-is", () => {
        expect(getResolvedText("~Some dialog~", messages)).toBe("~Some dialog~");
    });

    it("does not resolve partial matches like @100abc", () => {
        expect(getResolvedText("@100abc", messages)).toBe("@100abc");
    });
});

// ---------------------------------------------------------------------------
// getTransitionText
// ---------------------------------------------------------------------------

describe("getTransitionText", () => {
    const messages: Record<string, string> = { "50": "Yes, I agree" };

    function makeTransition(overrides: Partial<DDialogTransition> = {}): DDialogTransition {
        return {
            line: 1,
            target: { kind: "exit" },
            ...overrides,
        };
    }

    it("returns raw text in plain for reply with text", () => {
        const t = makeTransition({ replyText: "Sure thing" });
        const result = getTransitionText(t, {});
        expect(result.plain).toBe("Sure thing");
    });

    it("returns escaped text in html for reply with text", () => {
        const t = makeTransition({ replyText: '<script>alert("xss")</script>' });
        const result = getTransitionText(t, {});
        expect(result.html).toContain("&lt;script&gt;");
        expect(result.html).not.toContain("<script>");
    });

    it("resolves tra ref in replyText", () => {
        const t = makeTransition({ replyText: "@50" });
        const result = getTransitionText(t, messages);
        expect(result.plain).toBe("Yes, I agree");
        expect(result.html).toBe("Yes, I agree");
    });

    it("renders filter icon with trigger tooltip for silent transition with trigger", () => {
        const t = makeTransition({ trigger: 'Global("foo","LOCALS",1)' });
        const result = getTransitionText(t, {});
        expect(result.plain).toContain("foo");
        expect(result.html).toContain("codicon-filter");
        expect(result.html).toContain("title=");
    });

    it("escapes trigger text in tooltip attribute", () => {
        const t = makeTransition({ trigger: 'Check("a&b")' });
        const result = getTransitionText(t, {});
        expect(result.html).toContain("&amp;");
        expect(result.html).not.toContain('"a&b"');
    });

    it("returns (auto) for transitions with no reply and no trigger", () => {
        const t = makeTransition();
        const result = getTransitionText(t, {});
        expect(result.plain).toBe("(auto)");
        expect(result.html).toContain("(auto)");
    });
});

// ---------------------------------------------------------------------------
// renderTargetHtml
// ---------------------------------------------------------------------------

describe("renderTargetHtml", () => {
    it("renders goto as link with arrow icon", () => {
        const target: DDialogTarget = { kind: "goto", label: "state_1" };
        const html = renderTargetHtml(target);
        expect(html).toContain("node-link");
        expect(html).toContain('data-target="state_1"');
        expect(html).toContain("codicon-arrow-right");
    });

    it("escapes goto label", () => {
        const target: DDialogTarget = { kind: "goto", label: '<script>"xss"</script>' };
        const html = renderTargetHtml(target);
        expect(html).toContain("&lt;script&gt;");
        expect(html).not.toContain("<script>");
    });

    it("renders extern as marker with file and label", () => {
        const target: DDialogTarget = { kind: "extern", file: "IMOEN2", label: "state_5" };
        const html = renderTargetHtml(target);
        expect(html).toContain("EXTERN");
        expect(html).toContain("IMOEN2");
        expect(html).toContain("state_5");
    });

    it("renders exit with stop icon", () => {
        const target: DDialogTarget = { kind: "exit" };
        const html = renderTargetHtml(target);
        expect(html).toContain("codicon-stop-circle");
        expect(html).toContain("EXIT");
    });

    it("renders copy_trans with references icon", () => {
        const target: DDialogTarget = { kind: "copy_trans", file: "MINSC", label: "m_state" };
        const html = renderTargetHtml(target);
        expect(html).toContain("COPY_TRANS");
        expect(html).toContain("MINSC");
        expect(html).toContain("codicon-references");
    });
});

// ---------------------------------------------------------------------------
// getBlockStates
// ---------------------------------------------------------------------------

describe("getBlockStates", () => {
    const states: DDialogState[] = [
        { label: "s1", line: 1, sayText: "Hi", speaker: "GAELAN", transitions: [] },
        { label: "s2", line: 2, sayText: "Bye", speaker: "GAELAN", transitions: [] },
        { label: "chain_1", line: 3, sayText: "Chained", blockLabel: "mychain", transitions: [] },
        { label: "ext_1", line: 4, sayText: "Extended", blockLabel: "extend_10", transitions: [] },
    ];

    it("returns states matching speaker for begin block", () => {
        const block: DDialogBlock = { kind: "begin", file: "GAELAN", line: 1 };
        const result = getBlockStates(block, states);
        expect(result).toHaveLength(2);
        expect(result[0]?.label).toBe("s1");
    });

    it("returns states matching blockLabel for chain block", () => {
        const block: DDialogBlock = { kind: "chain", file: "GAELAN", line: 1, label: "mychain" };
        const result = getBlockStates(block, states);
        expect(result).toHaveLength(1);
        expect(result[0]?.label).toBe("chain_1");
    });

    it("returns states matching extend tag for extend block", () => {
        const block: DDialogBlock = { kind: "extend", file: "GAELAN", line: 10 };
        const result = getBlockStates(block, states);
        expect(result).toHaveLength(1);
        expect(result[0]?.label).toBe("ext_1");
    });

    it("returns empty array when no states match", () => {
        const block: DDialogBlock = { kind: "begin", file: "NOBODY", line: 1 };
        const result = getBlockStates(block, states);
        expect(result).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// buildDTreeHtml
// ---------------------------------------------------------------------------

describe("buildDTreeHtml", () => {
    it("returns 'no data' message for empty blocks", () => {
        const data: DDialogData = { blocks: [], states: [], messages: {} };
        expect(buildDTreeHtml(data)).toContain("No dialog data found");
    });

    it("returns 'no states' message when blocks exist but no matching states", () => {
        const data: DDialogData = {
            blocks: [{ kind: "begin", file: "GAELAN", line: 1 }],
            states: [],
            messages: {},
        };
        expect(buildDTreeHtml(data)).toContain("No dialog states found");
    });

    it("renders a simple begin block with one state", () => {
        const data: DDialogData = {
            blocks: [{ kind: "begin", file: "GAELAN", line: 1 }],
            states: [{
                label: "state_0",
                line: 1,
                sayText: "Hello adventurer",
                speaker: "GAELAN",
                transitions: [{ line: 2, replyText: "Hi there", target: { kind: "exit" } }],
            }],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        expect(html).toContain("state_0");
        expect(html).toContain("Hello adventurer");
        expect(html).toContain("Hi there");
        expect(html).toContain("EXIT");
    });

    it("escapes HTML in state text", () => {
        const data: DDialogData = {
            blocks: [{ kind: "begin", file: "NPC", line: 1 }],
            states: [{
                label: "xss_state",
                line: 1,
                sayText: '<img src=x onerror="alert(1)">',
                speaker: "NPC",
                transitions: [],
            }],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img");
    });

    it("escapes HTML in reply text attributes", () => {
        const data: DDialogData = {
            blocks: [{ kind: "begin", file: "NPC", line: 1 }],
            states: [{
                label: "s1",
                line: 1,
                sayText: "Hi",
                speaker: "NPC",
                transitions: [{
                    line: 2,
                    replyText: 'He said "hello" & waved',
                    target: { kind: "exit" },
                }],
            }],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        // data-fulltext attribute should be escaped
        expect(html).toContain("&amp;");
        expect(html).toContain("&quot;");
    });

    it("resolves tra refs via messages", () => {
        const data: DDialogData = {
            blocks: [{ kind: "begin", file: "NPC", line: 1 }],
            states: [{
                label: "s1",
                line: 1,
                sayText: "@100",
                speaker: "NPC",
                transitions: [],
            }],
            messages: { "100": "Translated text here" },
        };
        const html = buildDTreeHtml(data);
        expect(html).toContain("Translated text here");
    });

    it("renders goto transitions as links", () => {
        const data: DDialogData = {
            blocks: [{ kind: "begin", file: "NPC", line: 1 }],
            states: [
                {
                    label: "s1",
                    line: 1,
                    sayText: "First",
                    speaker: "NPC",
                    transitions: [{ line: 2, replyText: "Next", target: { kind: "goto", label: "s2" } }],
                },
                {
                    label: "s2",
                    line: 3,
                    sayText: "Second",
                    speaker: "NPC",
                    transitions: [{ line: 4, target: { kind: "exit" } }],
                },
            ],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        expect(html).toContain("s1");
        expect(html).toContain("s2");
        expect(html).toContain("Second");
    });

    it("skips file-level grouping for single target file", () => {
        const data: DDialogData = {
            blocks: [{ kind: "begin", file: "NPC", line: 1 }],
            states: [{
                label: "s1",
                line: 1,
                sayText: "Hi",
                speaker: "NPC",
                transitions: [],
            }],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        // Should not contain a file-level wrapper with the file name
        expect(html).toContain("BEGIN");
        // Single-file case: no codicon-file wrapper
        expect(html).not.toContain("codicon-file");
    });

    it("adds file-level grouping for multiple target files", () => {
        const data: DDialogData = {
            blocks: [
                { kind: "begin", file: "NPC1", line: 1 },
                { kind: "begin", file: "NPC2", line: 5 },
            ],
            states: [
                { label: "s1", line: 1, sayText: "Hi 1", speaker: "NPC1", transitions: [] },
                { label: "s2", line: 5, sayText: "Hi 2", speaker: "NPC2", transitions: [] },
            ],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        expect(html).toContain("NPC1");
        expect(html).toContain("NPC2");
        expect(html).toContain("codicon-file");
    });

    it("renders modify blocks as compact entries", () => {
        const data: DDialogData = {
            blocks: [{ kind: "modify", file: "NPC", line: 1, actionName: "SET_WEIGHT", stateRefs: ["s1"], description: "weight 5" }],
            states: [],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        expect(html).toContain("SET_WEIGHT");
        expect(html).toContain("Modifications");
    });
});
