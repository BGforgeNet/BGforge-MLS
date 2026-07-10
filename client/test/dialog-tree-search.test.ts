/**
 * Unit tests for the find-in-tree match collector. The flat/branch/cycle cases drive the REAL producer
 * (buildConversationTree) so the matcher is asserted against genuine ConvState shapes; the nested-block
 * arm is fed a hand-built block (the recursive walk is the mechanism under test there, and the block
 * shape itself is producer-pinned in conversation-tree.test.ts).
 */
import { describe, expect, it } from "vitest";
import { buildConversationTree, type ConversationTree } from "../src/dialog-editor/webview/conversation-tree";
import { collectMatches } from "../src/dialog-editor/webview/tree-search";
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
            { key: "Greet#0", stateId: "Greet", choiceId: "Greet#0" },
            { key: "More", stateId: "More" },
        ]);
    });

    it("matches a flat node's own NPC line as a state row", () => {
        expect(collectMatches(flatTree(), "long story")).toEqual([{ key: "More", stateId: "More" }]);
    });

    it("terminates on a cycle and reports each row once", () => {
        const r = root([
            st("A", "alpha line", [ch("A#0", { kind: "state", stateId: "B" }, { text: "to b" })]),
            st("B", "beta line", [ch("B#0", { kind: "state", stateId: "A" }, { text: "back to alpha" })]),
        ]);
        const tree = buildConversationTree(r, undefined, noJump);
        const matches = collectMatches(tree, "alpha");
        expect(matches).toEqual([
            { key: "A", stateId: "A" },
            { key: "B#0", stateId: "B", choiceId: "B#0" },
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
        const replyMatches = collectMatches(tree, "leave now");
        expect(replyMatches).toEqual([{ key: "Hub#opt1", stateId: "Hub", choiceId: "Hub#opt1" }]);
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
        expect(collectMatches(tree, "top of the block")).toEqual([{ key: "S", stateId: "S" }]);
        expect(collectMatches(tree, "a block option")).toEqual([{ key: "S#opt0", stateId: "S", choiceId: "S#opt0" }]);
        expect(collectMatches(tree, "inside the if")).toEqual([{ key: "S#0if", stateId: "S", branchKey: "S#0if" }]);
        expect(collectMatches(tree, "an else option")).toEqual([{ key: "S#opt1", stateId: "S", choiceId: "S#opt1" }]);
    });
});
