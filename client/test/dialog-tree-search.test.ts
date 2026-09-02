/**
 * Unit tests for the find-in-tree match collector. The flat/branch/cycle cases drive the REAL producer
 * (buildConversationTree) so the matcher is asserted against genuine ConvState shapes; the nested-block
 * arm is fed a hand-built block (the recursive walk is the mechanism under test there, and the block
 * shape itself is producer-pinned in conversation-tree.test.ts).
 */
import { describe, expect, it } from "vitest";
import { buildConversationTree, type ConversationTree } from "../src/dialog-editor/webview/conversation-tree";
import { collectMatches } from "../src/dialog-editor/webview/tree-search";
import { ch, noJump, root, st } from "./dialog-fixtures";

function flatTree(): ConversationTree {
    const r = root([
        st("Greet", "Hello there, traveler.", [
            ch("Greet#0", { kind: "state", stateId: "More" }, { text: "Tell me more." }),
            ch("Greet#1", { kind: "exit" }, { text: "Goodbye." }),
        ]),
        st("More", "It is a long story.", [ch("More#0", { kind: "exit" }, { text: "Enough." })]),
    ]);
    return buildConversationTree(r, undefined, noJump);
}

describe("collectMatches", () => {
    it("returns nothing for a blank or whitespace-only query", () => {
        expect(collectMatches(flatTree(), "")).toEqual([]);
        expect(collectMatches(flatTree(), "   ")).toEqual([]);
    });

    it("matches node ids, NPC lines, and option text in outline order, case-insensitively", () => {
        // "more" hits: Greet's option text, then the More node id, then its line? The id and the line are
        // separate rows only when both match - here "more" hits the option (Greet), the node id (More),
        // and nothing else; outline order is Greet's option first.
        const matches = collectMatches(flatTree(), "MoRe");
        expect(matches).toEqual([
            { key: "Greet#0", stateId: "Greet", choiceId: "Greet#0", kind: "dialogue" },
            { key: "More", stateId: "More", kind: "dialogue" },
        ]);
    });

    it("matches a flat node's own NPC line as a state row", () => {
        expect(collectMatches(flatTree(), "long story")).toEqual([{ key: "More", stateId: "More", kind: "dialogue" }]);
    });

    it("terminates on a cycle and reports each row once", () => {
        const r = root([
            st("A", "alpha line", [ch("A#0", { kind: "state", stateId: "B" }, { text: "to b" })]),
            st("B", "beta line", [ch("B#0", { kind: "state", stateId: "A" }, { text: "back to alpha" })]),
        ]);
        const tree = buildConversationTree(r, undefined, noJump);
        const matches = collectMatches(tree, "alpha");
        expect(matches).toEqual([
            { key: "A", stateId: "A", kind: "dialogue" },
            { key: "B#0", stateId: "B", choiceId: "B#0", kind: "dialogue" },
        ]);
    });

    it("matches a bundle node's branch lines (by branch key) and branch-scoped replies", () => {
        const r = root([
            st(
                "Hub",
                "@10",
                [
                    ch("Hub#opt0", { kind: "exit" }, { text: "ask about it", condition: "X==0" }),
                    ch("Hub#opt1", { kind: "exit" }, { text: "leave now", condition: "!(X==0)" }),
                ],
                {
                    branches: [
                        {
                            kind: "if",
                            condition: "X==0",
                            replies: [{ text: "@10" }],
                            choiceIds: ["Hub#opt0"],
                            opaque: [],
                        },
                        { kind: "else", replies: [{ text: "@20" }], choiceIds: ["Hub#opt1"], opaque: [] },
                    ],
                },
            ),
        ]);
        const tree = buildConversationTree(r, { "10": "First-time line", "20": "Later line" }, noJump);
        const lineMatches = collectMatches(tree, "later line");
        expect(lineMatches).toHaveLength(1);
        expect(lineMatches[0]!.stateId).toBe("Hub");
        expect(lineMatches[0]!.branchKey).toBeDefined();
        expect(lineMatches[0]!.kind).toBe("dialogue");
        const replyMatches = collectMatches(tree, "leave now");
        expect(replyMatches).toEqual([{ key: "Hub#opt1", stateId: "Hub", choiceId: "Hub#opt1", kind: "dialogue" }]);
    });

    it("walks a nested block: top-level lines select the state, branch lines their branch, replies their id", () => {
        // Hand-built block ConvState: the recursive walk is the mechanism under test; the block shape the
        // producer emits is pinned in conversation-tree.test.ts. Only the fields the walker reads are set,
        // hence the cast.
        const tree = {
            roots: [
                {
                    id: "S",
                    text: "",
                    replies: [],
                    block: [
                        { kind: "line", npc: "Top of the block", npcHasText: true },
                        { kind: "reply", reply: { id: "S#opt0", text: "a block option", target: { kind: "exit" } } },
                        {
                            kind: "group",
                            thenBlock: [{ kind: "line", npc: "Inside the if", npcHasText: true, branchKey: "S#0if" }],
                            elseBlock: [
                                {
                                    kind: "reply",
                                    reply: { id: "S#opt1", text: "an else option", target: { kind: "exit" } },
                                },
                            ],
                        },
                    ],
                },
            ],
        } as unknown as ConversationTree;
        expect(collectMatches(tree, "top of the block")).toEqual([{ key: "S", stateId: "S", kind: "dialogue" }]);
        expect(collectMatches(tree, "a block option")).toEqual([
            { key: "S#opt0", stateId: "S", choiceId: "S#opt0", kind: "dialogue" },
        ]);
        expect(collectMatches(tree, "inside the if")).toEqual([
            { key: "S#0if", stateId: "S", branchKey: "S#0if", kind: "dialogue" },
        ]);
        expect(collectMatches(tree, "an else option")).toEqual([
            { key: "S#opt1", stateId: "S", choiceId: "S#opt1", kind: "dialogue" },
        ]);
    });

    // ---- Code search (includeCode) --------------------------------------------------------------------
    // Default (option omitted or false) pins the recorded decision: a trigger/condition/action is code, not
    // dialogue, and stays unsearched. `includeCode: true` is the opt-in escape hatch.

    it("finds a state trigger only when includeCode is set, selecting the owner state", () => {
        const r = root([
            st("Gate", "Welcome.", [ch("Gate#0", { kind: "exit" }, { text: "Bye." })], {
                trigger: 'global_var("met_npc") == 1',
            }),
        ]);
        const tree = buildConversationTree(r, undefined, noJump);
        expect(collectMatches(tree, "met_npc")).toEqual([]);
        expect(collectMatches(tree, "met_npc", { includeCode: true })).toEqual([
            { key: "Gate", stateId: "Gate", kind: "code" },
        ]);
    });

    it("finds a choice condition or action only when includeCode is set, selecting the option", () => {
        const r = root([
            st("Greet", "Hello.", [
                ch("Greet#0", { kind: "exit" }, { text: "Take the gold.", condition: "gold_available()" }),
                ch("Greet#1", { kind: "exit" }, { text: "Leave.", action: "DO ~set_flag(1)~" }),
            ]),
        ]);
        const tree = buildConversationTree(r, undefined, noJump);
        expect(collectMatches(tree, "gold_available")).toEqual([]);
        expect(collectMatches(tree, "gold_available", { includeCode: true })).toEqual([
            { key: "Greet#0", stateId: "Greet", choiceId: "Greet#0", kind: "code" },
        ]);
        expect(collectMatches(tree, "set_flag")).toEqual([]);
        expect(collectMatches(tree, "set_flag", { includeCode: true })).toEqual([
            { key: "Greet#1", stateId: "Greet", choiceId: "Greet#1", kind: "code" },
        ]);
    });

    it("finds a bundle branch's own condition only when includeCode is set, selecting the branch", () => {
        const r = root([
            st(
                "Hub",
                "@10",
                [
                    ch("Hub#opt0", { kind: "exit" }, { text: "ask about it" }),
                    ch("Hub#opt1", { kind: "exit" }, { text: "leave now" }),
                ],
                {
                    branches: [
                        {
                            kind: "if",
                            condition: "quest_active(7)",
                            replies: [{ text: "@10" }],
                            choiceIds: ["Hub#opt0"],
                            opaque: [],
                        },
                        { kind: "else", replies: [{ text: "@20" }], choiceIds: ["Hub#opt1"], opaque: [] },
                    ],
                },
            ),
        ]);
        const tree = buildConversationTree(r, { "10": "First-time line", "20": "Later line" }, noJump);
        expect(collectMatches(tree, "quest_active")).toEqual([]);
        // Both branches carry "quest_active" in their displayed condition: the if branch's own condition, and
        // the else branch's auto-negated `not quest_active(7)` (conversation-tree.ts inverts the if condition
        // for the else's heading).
        const matches = collectMatches(tree, "quest_active", { includeCode: true });
        expect(matches).toHaveLength(2);
        for (const m of matches) {
            expect(m).toMatchObject({ stateId: "Hub", kind: "code" });
            expect(m.branchKey).toBeDefined();
        }
    });

    it("walks a nested block's branch-line condition only when includeCode is set", () => {
        const tree = {
            roots: [
                {
                    id: "S",
                    text: "",
                    replies: [],
                    block: [
                        {
                            kind: "group",
                            thenBlock: [
                                {
                                    kind: "line",
                                    npc: "Inside the if",
                                    npcHasText: true,
                                    branchKey: "S#0if",
                                    condition: "has_item(7)",
                                },
                            ],
                        },
                    ],
                },
            ],
        } as unknown as ConversationTree;
        expect(collectMatches(tree, "has_item")).toEqual([]);
        expect(collectMatches(tree, "has_item", { includeCode: true })).toEqual([
            { key: "S#0if", stateId: "S", branchKey: "S#0if", kind: "code" },
        ]);
    });

    it("keeps dialogue matches identical whether includeCode is on or off", () => {
        expect(collectMatches(flatTree(), "MoRe", { includeCode: true })).toEqual(collectMatches(flatTree(), "MoRe"));
        const r = root([
            st("A", "alpha line", [ch("A#0", { kind: "state", stateId: "B" }, { text: "to b" })]),
            st("B", "beta line", [ch("B#0", { kind: "state", stateId: "A" }, { text: "back to alpha" })]),
        ]);
        const tree = buildConversationTree(r, undefined, noJump);
        expect(collectMatches(tree, "alpha", { includeCode: true })).toEqual(collectMatches(tree, "alpha"));
    });

    it("counts a row matching in both dialogue and code once, dialogue winning", () => {
        const r = root([
            st("Greet", "Hello.", [
                ch("Greet#0", { kind: "exit" }, { text: "check the gold stash", condition: "gold_stash_check()" }),
            ]),
        ]);
        const tree = buildConversationTree(r, undefined, noJump);
        expect(collectMatches(tree, "gold", { includeCode: true })).toEqual([
            { key: "Greet#0", stateId: "Greet", choiceId: "Greet#0", kind: "dialogue" },
        ]);
    });
});
