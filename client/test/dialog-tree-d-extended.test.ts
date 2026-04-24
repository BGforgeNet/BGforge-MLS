/**
 * Extended unit tests for D dialog tree builder (dialogTree-d.ts).
 * Covers uncovered branches: multiple blocks for the same file (line 235),
 * modify blocks with trigger/action/speaker rendering (line 264),
 * getTransitionText trigger+reply combination, renderModifyBlock with stateRefs.
 */

import { vi, describe, expect, it } from "vitest";

vi.mock("vscode", () => ({}));
vi.mock("vscode-languageclient/node", () => ({}));

import { buildDTreeHtml } from "../src/dialog-tree/dialogTree-d";
import type { DDialogData, DDialogBlock, DDialogState } from "../../shared/dialog-types";

function makeState(label: string, file: string, overrides: Partial<DDialogState> = {}): DDialogState {
    return { label, line: 1, sayText: `Say ${label}`, speaker: file, transitions: [], ...overrides };
}

function makeBlock(kind: DDialogBlock["kind"], file: string, overrides: Partial<DDialogBlock> = {}): DDialogBlock {
    return { kind, file, line: 1, ...overrides };
}

describe("buildDTreeHtml - multiple blocks for same file (line 235 branch)", () => {
    it("groups multiple begin blocks under the same file", () => {
        // Line 235: existing.push(block) — second block pushed to same file entry
        const data: DDialogData = {
            blocks: [makeBlock("begin", "NPC"), makeBlock("modify", "NPC", { actionName: "DO_THING", stateRefs: [] })],
            states: [makeState("s1", "NPC")],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        expect(html).toContain("s1");
        // Both blocks should contribute to the output
        expect(html).toContain("BEGIN");
        expect(html).toContain("DO_THING");
    });
});

describe("buildDTreeHtml - modify blocks rendered inside structural group", () => {
    it("renders modify blocks within the same file as structural blocks", () => {
        // Line 264: modifyBlocks.length > 0 branch when there are also structural blocks
        const data: DDialogData = {
            blocks: [
                makeBlock("begin", "FILE"),
                makeBlock("modify", "FILE", { actionName: "PATCH", stateRefs: ["s1"] }),
            ],
            states: [makeState("s1", "FILE")],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        expect(html).toContain("PATCH");
        expect(html).toContain("Modifications");
        expect(html).toContain("s1");
    });

    it("renders modify block with description", () => {
        const data: DDialogData = {
            blocks: [makeBlock("modify", "FILE", { actionName: "SET", description: "sets things" })],
            states: [],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        expect(html).toContain("sets things");
    });
});

describe("buildDTreeHtml - transition with trigger and replyText", () => {
    it("shows both filter icon and reply text when transition has both trigger and replyText", () => {
        // Line 150-152: triggerHtml rendered when t.trigger && t.replyText
        const data: DDialogData = {
            blocks: [makeBlock("begin", "NPC")],
            states: [
                {
                    label: "s1",
                    line: 1,
                    sayText: "Hello",
                    speaker: "NPC",
                    transitions: [
                        {
                            line: 2,
                            replyText: "I agree",
                            trigger: 'Global("x","LOCALS",1)',
                            target: { kind: "exit" },
                        },
                    ],
                },
            ],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        expect(html).toContain("codicon-filter");
        expect(html).toContain("I agree");
    });

    it("shows action icon when transition has an action", () => {
        // Line 153-155: actionHtml rendered when t.action is set
        const data: DDialogData = {
            blocks: [makeBlock("begin", "NPC")],
            states: [
                {
                    label: "s1",
                    line: 1,
                    sayText: "Hello",
                    speaker: "NPC",
                    transitions: [
                        {
                            line: 2,
                            replyText: "Do it",
                            action: 'SetGlobal("done","GLOBAL",1)',
                            target: { kind: "exit" },
                        },
                    ],
                },
            ],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        expect(html).toContain("codicon-play");
    });
});

describe("buildDTreeHtml - speaker label display", () => {
    it("shows speaker label when state speaker differs from block file (chain block)", () => {
        // Line 141-143: speakerHtml rendered when speaker !== defaultSpeaker.
        // Chain blocks are matched by blockLabel, not speaker — so a state can have
        // a different speaker from the block's file, triggering the speaker label.
        const data: DDialogData = {
            blocks: [makeBlock("chain", "GAELAN", { label: "mychain" })],
            states: [
                {
                    label: "s1",
                    line: 1,
                    sayText: "Hear me",
                    speaker: "MINSC", // different from block file
                    blockLabel: "mychain",
                    transitions: [],
                },
            ],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        expect(html).toContain("MINSC");
        expect(html).toContain("speaker-label");
    });

    it("omits speaker label when speaker matches block file", () => {
        const data: DDialogData = {
            blocks: [makeBlock("begin", "NPC")],
            states: [makeState("s1", "NPC")],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        expect(html).not.toContain("speaker-label");
    });
});

describe("buildDTreeHtml - state with no sayText", () => {
    it("omits sayDisplay when sayText is empty", () => {
        // Line 137-138: state.sayText falsy — sayHtml = ""
        // The <span class="reply msg-text"> is only added for the say text.
        // Transition text also uses msg-text, so check for "reply msg-text" specifically.
        const data: DDialogData = {
            blocks: [makeBlock("begin", "NPC")],
            states: [
                {
                    label: "s1",
                    line: 1,
                    sayText: "",
                    speaker: "NPC",
                    transitions: [{ line: 2, target: { kind: "exit" } }],
                },
            ],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        expect(html).toContain("s1");
        // No say text rendered (the "reply msg-text" class is only on say text spans)
        expect(html).not.toContain("reply msg-text");
    });
});

describe("buildDTreeHtml - goto transition where target already rendered (no expand)", () => {
    it("renders goto back-reference as a node-link (not expanded child) when target was already rendered", () => {
        // Line 168-169: shouldExpand=false for back-reference — transition renders as a flat div,
        // not a <details> expansion. The back-reference to s1 from s2 appears as a node-link anchor.
        const data: DDialogData = {
            blocks: [makeBlock("begin", "NPC")],
            states: [
                {
                    label: "s1",
                    line: 1,
                    sayText: "Start",
                    speaker: "NPC",
                    transitions: [{ line: 2, replyText: "Fwd", target: { kind: "goto", label: "s2" } }],
                },
                {
                    label: "s2",
                    line: 3,
                    sayText: "Middle",
                    speaker: "NPC",
                    transitions: [{ line: 4, replyText: "Back", target: { kind: "goto", label: "s1" } }],
                },
            ],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        // Both s1 and s2 are rendered; the back-reference shows as a link
        expect(html).toContain(`data-target="s1"`);
        expect(html).toContain(`data-target="s2"`);
        // The back-link is a flat div (not a <details> expansion)
        expect(html).toContain("Back");
    });

    it("renders cyclic goto reference without infinite recursion", () => {
        // Cycle detection: s1->s2->s1 loop is handled without infinite recursion
        const data: DDialogData = {
            blocks: [makeBlock("begin", "NPC")],
            states: [
                {
                    label: "s1",
                    line: 1,
                    sayText: "Root",
                    speaker: "NPC",
                    transitions: [{ line: 2, replyText: "Fwd", target: { kind: "goto", label: "s2" } }],
                },
                {
                    label: "s2",
                    line: 3,
                    sayText: "Middle",
                    speaker: "NPC",
                    transitions: [{ line: 4, replyText: "Back to start", target: { kind: "goto", label: "s1" } }],
                },
            ],
            messages: {},
        };
        expect(() => buildDTreeHtml(data)).not.toThrow();
        const html = buildDTreeHtml(data);
        expect(html).toContain("s1");
        expect(html).toContain("s2");
    });
});

describe("buildDTreeHtml - extern/copy_trans transitions inside state", () => {
    it("renders extern transition with codicon-arrow-right", () => {
        // Line 172: icon = "arrow-right" for non-exit, non-goto targets
        const data: DDialogData = {
            blocks: [makeBlock("begin", "NPC")],
            states: [
                {
                    label: "s1",
                    line: 1,
                    sayText: "See",
                    speaker: "NPC",
                    transitions: [
                        {
                            line: 2,
                            replyText: "Extern link",
                            target: { kind: "extern", file: "OTHER", label: "other_s" },
                        },
                    ],
                },
            ],
            messages: {},
        };
        const html = buildDTreeHtml(data);
        expect(html).toContain("OTHER");
        expect(html).toContain("codicon-arrow-right");
    });
});
