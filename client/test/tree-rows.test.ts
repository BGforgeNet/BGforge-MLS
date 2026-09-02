/**
 * Unit tests for the tree outline's flat row projection.
 *
 * The outline renders a window of rows rather than the whole conversation, so the recursive nesting has to
 * become one ordered array first. This is that projection: the row sequence here must match, one for one and
 * in order, what the recursive snippets in Tree.svelte used to emit.
 *
 * The input is built through the real `buildConversationTree` rather than hand-written ConvStates.
 */
import { describe, expect, it } from "vitest";
import { buildConversationTree } from "../src/dialog-editor/webview/conversation-tree";
import { ariaPositions, flattenRows, rowAriaLevel } from "../src/dialog-editor/webview/tree-rows";
import { ch, noJump, root, st } from "./dialog-fixtures";

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

describe("a deep linear conversation", () => {
    // The outline used to draw through mutually recursive snippets, one component frame per nesting level,
    // and a chain this deep blew the browser stack outright. The projection replaced that recursion, so this
    // pins the depth the projection itself survives. It does NOT prove the VIEW stays flat - that property
    // lives in Tree.svelte's window and only a browser tier can observe it.
    const DEPTH = 150;

    function chain(depth: number) {
        return root(
            Array.from({ length: depth }, (_, i) =>
                st(
                    `s${i}`,
                    `Line ${i}`,
                    i === depth - 1 ? [] : [ch(`s${i}#0`, { kind: "state", stateId: `s${i + 1}` }, { text: "on" })],
                ),
            ),
        );
    }

    it("projects every state and option, at full nesting depth", () => {
        const tree = buildConversationTree(chain(DEPTH), undefined, noJump);

        const rows = flattenRows(tree.roots, new Set(), new Set());

        expect(rows.filter((r) => r.kind === "state")).toHaveLength(DEPTH);
        expect(rows.filter((r) => r.kind === "reply")).toHaveLength(DEPTH - 1);
        expect(Math.max(...rows.map((r) => r.depth))).toBe(DEPTH - 1);
        // A collision here would silently drop rows from the keyed {#each} the outline renders.
        expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    });

    it("numbers each link's option and next state as one sibling pair, however deep", () => {
        const tree = buildConversationTree(chain(DEPTH), undefined, noJump);

        const rows = flattenRows(tree.roots, new Set(), new Set());
        const pos = ariaPositions(rows);
        const deepest = rows.filter((r) => r.depth >= DEPTH - 2 && rowAriaLevel(r) !== undefined);

        // Every link is a pair: the option, then the state it leads to, both under the state above them.
        // So the second-to-last state is item 2 of ITS parent's pair, and it in turn parents the last pair.
        expect(deepest.map((r) => pos.get(r.key))).toEqual([
            { pos: 2, size: 2 },
            { pos: 1, size: 2 },
            { pos: 2, size: 2 },
        ]);
    });
});

describe("ariaPositions", () => {
    // aria-setsize/aria-posinset describe the set of nodes at one level under one parent - that is the
    // whole reason a virtualized tree has to supply them, since the DOM holds only a window. Reporting the
    // flat row list's own length and index instead announces a deeply nested node as "item N of <everything>",
    // and counts rows that are not treeitems at all.
    it("numbers the root states among themselves", () => {
        const tree = buildConversationTree(root([st("A", "one", []), st("B", "two", [])]), undefined, noJump);

        const rows = flattenRows(tree.roots, new Set(), new Set());
        const pos = ariaPositions(rows);

        expect(rows.map((r) => pos.get(r.key))).toEqual([
            { pos: 1, size: 2 },
            { pos: 2, size: 2 },
        ]);
    });

    it("groups a state's options and their target states into one sibling set, in row order", () => {
        // A target state is emitted straight after the option that leads to it and carries the SAME
        // aria-level, so the two are siblings: the set is [option, its target, next option].
        const tree = buildConversationTree(
            root([
                st("A", "hi", [
                    ch("A#0", { kind: "state", stateId: "B" }, { text: "go" }),
                    ch("A#1", { kind: "exit" }, { text: "bye" }),
                ]),
                st("B", "there", []),
            ]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(), new Set());
        const pos = ariaPositions(rows);
        const under = rows.filter((r) => rowAriaLevel(r) === 2);

        expect(under).toHaveLength(3);
        expect(under.map((r) => pos.get(r.key))).toEqual([
            { pos: 1, size: 3 },
            { pos: 2, size: 3 },
            { pos: 3, size: 3 },
        ]);
    });

    it("counts a nested state's own options against that state, not against its grandparent", () => {
        const tree = buildConversationTree(
            root([
                st("A", "hi", [ch("A#0", { kind: "state", stateId: "B" }, { text: "go" })]),
                st("B", "there", [
                    ch("B#0", { kind: "exit" }, { text: "one" }),
                    ch("B#1", { kind: "exit" }, { text: "two" }),
                ]),
            ]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(), new Set());
        const pos = ariaPositions(rows);
        const bReplies = rows.filter((r) => r.kind === "reply" && r.ownerId === "B");

        expect(bReplies.map((r) => pos.get(r.key))).toEqual([
            { pos: 1, size: 2 },
            { pos: 2, size: 2 },
        ]);
    });

    it("skips rows that are not treeitems, so they never inflate a sibling count", () => {
        // A "+ option" row and a continuation SAY line render inside the tree but carry no treeitem role.
        const tree = buildConversationTree(
            root([st("A", "hi", [ch("A#0", { kind: "exit" }, { text: "bye" })], { sayTexts: ["hi", "second line"] })]),
            undefined,
            noJump,
        );

        const rows = flattenRows(tree.roots, new Set(), new Set(["A"]));
        const pos = ariaPositions(rows);

        const plain = rows.filter((r) => rowAriaLevel(r) === undefined);
        expect(plain.map((r) => r.kind)).toEqual(["sayCont", "addOption"]);
        expect(plain.map((r) => pos.get(r.key))).toEqual([undefined, undefined]);

        // The one option is alone in its set - neither of the two plain rows was counted into it.
        const reply = rows.find((r) => r.kind === "reply")!;
        expect(pos.get(reply.key)).toEqual({ pos: 1, size: 1 });
    });
});
