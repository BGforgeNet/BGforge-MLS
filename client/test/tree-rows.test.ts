/**
 * Unit tests for the tree outline's flat row projection.
 *
 * The outline renders a window of rows rather than the whole conversation, so the recursive nesting has to
 * become one ordered array first. This is that projection: the row sequence here must match, one for one and
 * in order, what the recursive snippets in Tree.svelte used to emit.
 *
 * Fixture builders replicate client/test/conversation-tree.test.ts so both suites describe a dialog the same
 * way, and the input is built through the real `buildConversationTree` rather than hand-written ConvStates.
 */
import { describe, expect, it } from "vitest";
import { buildConversationTree } from "../src/dialog-editor/webview/conversation-tree";
import { flattenRows } from "../src/dialog-editor/webview/tree-rows";
import type { DialogChoice, DialogRoot, DialogState, DialogTarget } from "../../shared/dialog-model";

function st(id: string, text: string, choices: DialogChoice[], extra: Partial<DialogState> = {}): DialogState {
    return { id, speaker: "NPC", text, choices, ...extra };
}
function ch(id: string, target: DialogTarget, extra: Partial<DialogChoice> = {}): DialogChoice {
    return { id, target, ...extra };
}
function root(states: DialogState[]): DialogRoot {
    return { id: "dialog:NPC", label: "NPC", kind: "dialog", states };
}
const noJump = (): undefined => undefined;

describe("flattenRows", () => {
    it("emits a state row followed by its reply rows, in render order", () => {
        const tree = buildConversationTree(
            root([
                st("A", "hi", [
                    ch("A#0", { kind: "exit" }, { text: "first" }),
                    ch("A#1", { kind: "exit" }, { text: "second" }),
                ]),
            ]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(), new Set());

        expect(rows.map((r) => r.kind)).toEqual(["state", "reply", "reply"]);
    });

    it("expands a reply's target state inline, directly after the reply that leads to it", () => {
        const tree = buildConversationTree(
            root([
                st("A", "hi", [ch("A#0", { kind: "state", stateId: "B" }, { text: "go" })]),
                st("B", "bye", [ch("B#0", { kind: "exit" })]),
            ]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(), new Set());

        expect(rows.map((r) => (r.kind === "state" ? `state:${r.state.id}` : r.kind))).toEqual([
            "state:A",
            "reply",
            "state:B",
            "reply",
        ]);
    });

    it("keeps a collapsed state's own row but omits everything nested under it", () => {
        const tree = buildConversationTree(
            root([
                st("A", "hi", [ch("A#0", { kind: "state", stateId: "B" }, { text: "go" })]),
                st("B", "bye", [ch("B#0", { kind: "exit" })]),
            ]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(["A"]), new Set());

        expect(rows.map((r) => (r.kind === "state" ? `state:${r.state.id}` : r.kind))).toEqual(["state:A"]);
    });

    it("carries the nesting depth each row is indented by", () => {
        const tree = buildConversationTree(
            root([
                st("A", "hi", [ch("A#0", { kind: "state", stateId: "B" }, { text: "go" })]),
                st("B", "bye", [ch("B#0", { kind: "exit" })]),
            ]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(), new Set());

        // A reply sits at its owner's depth (the view renders it one half-notch in); the state it leads to
        // is one full level deeper.
        expect(rows.map((r) => [r.kind, r.depth])).toEqual([
            ["state", 0],
            ["reply", 0],
            ["state", 1],
            ["reply", 1],
        ]);
    });

    it("carries the reply and the id of the state that owns it on each reply row", () => {
        const tree = buildConversationTree(
            root([st("A", "hi", [ch("A#0", { kind: "exit" }, { text: "bye then" })])]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(), new Set());

        const reply = rows.find((r) => r.kind === "reply");
        expect(reply?.ownerId).toBe("A");
        expect(reply?.reply.id).toBe("A#0");
        expect(reply?.reply.text).toBe("bye then");
    });

    it("appends an add-option row after an editable state's replies", () => {
        const tree = buildConversationTree(
            root([st("A", "hi", [ch("A#0", { kind: "exit" }, { text: "bye" })])]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(), new Set(["A"]));

        expect(rows.map((r) => r.kind)).toEqual(["state", "reply", "addOption"]);
    });

    it("offers the add-option row on an editable state that has no replies yet", () => {
        const tree = buildConversationTree(root([st("A", "a dead end", [])]), undefined, noJump);

        const rows = flattenRows(tree.roots, new Set(), new Set(["A"]));

        expect(rows.map((r) => r.kind)).toEqual(["state", "addOption"]);
    });

    it("emits one continuation row per extra SAY line of a multisay state, before its replies", () => {
        // sayTexts[0] is the state's own `text`; lines 2..N are the continuation the outline shows so a
        // monologue is not truncated to its first line.
        const tree = buildConversationTree(
            root([
                st("A", "first", [ch("A#0", { kind: "exit" }, { text: "bye" })], {
                    sayTexts: ["first", "second", "third"],
                }),
            ]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(), new Set());

        expect(rows.map((r) => r.kind)).toEqual(["state", "sayCont", "sayCont", "reply"]);
        expect(rows.filter((r) => r.kind === "sayCont").map((r) => r.line)).toEqual(["second", "third"]);
    });

    it("emits each bundle branch's NPC line followed by the options that branch gates", () => {
        const tree = buildConversationTree(
            root([
                st(
                    "A",
                    "",
                    [ch("A#0", { kind: "exit" }, { text: "yes" }), ch("A#1", { kind: "exit" }, { text: "no" })],
                    {
                        branches: [
                            {
                                kind: "if",
                                condition: "(x)",
                                replies: [{ text: "if line" }],
                                choiceIds: ["A#0"],
                                opaque: [],
                            },
                            { kind: "else", replies: [{ text: "else line" }], choiceIds: ["A#1"], opaque: [] },
                        ],
                    },
                ),
            ]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(), new Set());

        expect(rows.map((r) => r.kind)).toEqual(["state", "branchLine", "reply", "branchLine", "reply"]);
        expect(rows.filter((r) => r.kind === "branchLine").map((r) => [r.npc, r.isElse])).toEqual([
            ["if line", false],
            ["else line", true],
        ]);
    });

    it("offers no add-option row on a bundle state, whose options live inside its branches", () => {
        const tree = buildConversationTree(
            root([
                st("A", "", [ch("A#0", { kind: "exit" }, { text: "yes" })], {
                    branches: [
                        {
                            kind: "if",
                            condition: "(x)",
                            replies: [{ text: "if line" }],
                            choiceIds: ["A#0"],
                            opaque: [],
                        },
                    ],
                }),
            ]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(), new Set(["A"]));

        expect(rows.map((r) => r.kind)).not.toContain("addOption");
    });

    it("walks a structured node's nested if/else group, then-block before else-block", () => {
        // The node's opening line sits on the state row itself, so the block rows start at the group.
        const tree = buildConversationTree(
            root([
                st(
                    "A",
                    "opening",
                    [ch("A#0", { kind: "exit" }, { text: "yes" }), ch("A#1", { kind: "exit" }, { text: "no" })],
                    {
                        structured: true,
                        block: [
                            { kind: "line", text: "opening" },
                            {
                                kind: "group",
                                condition: "(x)",
                                thenBlock: [
                                    { kind: "line", text: "then line" },
                                    { kind: "choice", choiceId: "A#0" },
                                ],
                                elseBlock: [
                                    { kind: "line", text: "else line" },
                                    { kind: "choice", choiceId: "A#1" },
                                ],
                            },
                        ],
                    },
                ),
            ]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(), new Set());

        expect(rows.map((r) => r.kind)).toEqual(["state", "branchLine", "reply", "branchLine", "reply"]);
        expect(rows.filter((r) => r.kind === "branchLine").map((r) => r.npc)).toEqual(["then line", "else line"]);
    });

    it("carries each flat option's position in its own state's option list", () => {
        // The context menu acts on position ("move up", "move down"), so a row needs its index and the size
        // of the list it sits in.
        const tree = buildConversationTree(
            root([
                st("A", "hi", [
                    ch("A#0", { kind: "exit" }, { text: "one" }),
                    ch("A#1", { kind: "exit" }, { text: "two" }),
                    ch("A#2", { kind: "exit" }, { text: "three" }),
                ]),
            ]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(), new Set());

        expect(rows.filter((r) => r.kind === "reply").map((r) => [r.index, r.count])).toEqual([
            [0, 3],
            [1, 3],
            [2, 3],
        ]);
    });

    it("marks a bundle branch's options structurally read-only, and a flat state's options editable", () => {
        const bundle = buildConversationTree(
            root([
                st("A", "", [ch("A#0", { kind: "exit" }, { text: "yes" })], {
                    branches: [
                        {
                            kind: "if",
                            condition: "(x)",
                            replies: [{ text: "if line" }],
                            choiceIds: ["A#0"],
                            opaque: [],
                        },
                    ],
                }),
            ]),
            undefined,
            noJump,
        );
        const flat = buildConversationTree(
            root([st("B", "hi", [ch("B#0", { kind: "exit" }, { text: "yes" })])]),
            undefined,
            noJump,
        );

        const bundleReply = flattenRows(bundle.roots, new Set(), new Set()).find((r) => r.kind === "reply");
        const flatReply = flattenRows(flat.roots, new Set(), new Set()).find((r) => r.kind === "reply");

        expect(bundleReply?.branchReadonly).toBe(true);
        expect(flatReply?.branchReadonly).toBe(false);
    });

    it("gives every row a key unique across the whole list", () => {
        // The view renders one keyed {#each} over these rows, so a repeated key would drop rows silently.
        const tree = buildConversationTree(
            root([
                st("A", "first", [ch("A#0", { kind: "state", stateId: "B" }, { text: "go" })], {
                    sayTexts: ["first", "second", "third"],
                }),
                st("B", "second", [ch("B#0", { kind: "exit" }, { text: "bye" })], {
                    sayTexts: ["second", "more", "more"],
                }),
            ]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(), new Set(["A", "B"]));
        const keys = rows.map((r) => r.key);

        expect(new Set(keys).size).toBe(rows.length);
    });

    it("re-keys an option row when its target shape changes, so the row remounts instead of updating", () => {
        // A live re-parse can flip a reply's target (a `state` target becomes `external` when its destination
        // vanishes mid-edit). Reusing the row in place re-ran its deriveds against the stale target and threw,
        // wedging the tree; a changed key tears the row down instead.
        const toState = buildConversationTree(
            root([st("A", "hi", [ch("A#0", { kind: "state", stateId: "B" }, { text: "go" })]), st("B", "bye", [])]),
            undefined,
            noJump,
        );
        const toExit = buildConversationTree(
            root([st("A", "hi", [ch("A#0", { kind: "exit" }, { text: "go" })])]),
            undefined,
            noJump,
        );

        const keyToState = flattenRows(toState.roots, new Set(), new Set()).find((r) => r.kind === "reply")?.key;
        const keyToExit = flattenRows(toExit.roots, new Set(), new Set()).find((r) => r.kind === "reply")?.key;

        expect(keyToState).toBeDefined();
        expect(keyToExit).toBeDefined();
        expect(keyToState).not.toBe(keyToExit);
    });
});
