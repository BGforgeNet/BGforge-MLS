/**
 * Unit tests for the tree find-bar's pure match collector (tree-search.ts).
 *
 * Fixtures are hand-built ConversationTrees rather than parsed from a real .ssl: the goal is to pin the exact
 * match ORDER and the KEY chosen for each row kind (state id, choice id, branch key) across the three render
 * tiers - flat replies, if/else branches, and a nested block - which one real file rarely exercises all of at
 * once. Reason (c) for synthetic fixtures: concentrate the specific edge cases the matcher must order.
 */
import { describe, expect, it } from "vitest";
import { collectMatches } from "../src/dialog-editor/webview/tree-search";
import type { ConvReply, ConversationTree } from "../src/dialog-editor/webview/conversation-tree";

const exitReply = (id: string, text: string): ConvReply => ({
    id,
    text,
    hasText: true,
    textEditable: true,
    target: { kind: "exit" },
});

describe("collectMatches", () => {
    it("returns nothing for a blank or whitespace-only query", () => {
        const tree: ConversationTree = {
            roots: [
                {
                    id: "Node001",
                    text: "hello there",
                    replies: [exitReply("Node001#opt0", "bye")],
                    isEntry: true,
                    textEditable: true,
                },
            ],
        };
        expect(collectMatches(tree, "")).toEqual([]);
        expect(collectMatches(tree, "   ")).toEqual([]);
    });

    it("matches a flat node's line text and its option text, keyed by state id and choice id", () => {
        const tree: ConversationTree = {
            roots: [
                {
                    id: "Node001",
                    text: "The guard eyes you warily.",
                    replies: [exitReply("Node001#opt0", "Who are you?"), exitReply("Node001#opt1", "Goodbye.")],
                    isEntry: true,
                    textEditable: true,
                },
            ],
        };
        // Line text match -> whole state.
        expect(collectMatches(tree, "warily")).toEqual([{ key: "Node001", stateId: "Node001" }]);
        // Option text match -> the option.
        expect(collectMatches(tree, "who are you")).toEqual([
            { key: "Node001#opt0", stateId: "Node001", choiceId: "Node001#opt0" },
        ]);
    });

    it("matches a node id even when no text matches", () => {
        const tree: ConversationTree = {
            roots: [{ id: "Node042", text: "some line", replies: [], isEntry: true, textEditable: true }],
        };
        expect(collectMatches(tree, "node042")).toEqual([{ key: "Node042", stateId: "Node042" }]);
    });

    it("matches an if/else branch's NPC line (keyed by branch key) and its replies (keyed by choice id)", () => {
        const tree: ConversationTree = {
            roots: [
                {
                    id: "Node001",
                    text: "",
                    replies: [],
                    isEntry: true,
                    textEditable: true,
                    branches: [
                        {
                            kind: "if",
                            condition: "(has_quest)",
                            npc: "You came back!",
                            npcHasText: true,
                            branchKey: "Node001#branch0",
                            replies: [{ ...exitReply("Node001#opt0", "I did."), branchKey: "Node001#branch0" }],
                        },
                        {
                            kind: "else",
                            npc: "Do I know you?",
                            npcHasText: true,
                            branchKey: "Node001#branch1",
                            replies: [{ ...exitReply("Node001#opt1", "Not yet."), branchKey: "Node001#branch1" }],
                        },
                    ],
                },
            ],
        };
        expect(collectMatches(tree, "came back")).toEqual([
            { key: "Node001#branch0", stateId: "Node001", branchKey: "Node001#branch0" },
        ]);
        expect(collectMatches(tree, "know you")).toEqual([
            { key: "Node001#branch1", stateId: "Node001", branchKey: "Node001#branch1" },
        ]);
        expect(collectMatches(tree, "not yet")).toEqual([
            { key: "Node001#opt1", stateId: "Node001", choiceId: "Node001#opt1" },
        ]);
    });

    it("matches nested block lines (branch key) and a top-level block line (state id)", () => {
        const tree: ConversationTree = {
            roots: [
                {
                    id: "Node001",
                    text: "",
                    replies: [],
                    isEntry: true,
                    textEditable: true,
                    block: [
                        { kind: "line", npc: "Well met, traveler.", npcHasText: true },
                        {
                            kind: "group",
                            condition: "(is_night)",
                            thenBlock: [
                                { kind: "line", npc: "The moon is high.", npcHasText: true, branchKey: "Node001#Nif" },
                            ],
                            elseBlock: [
                                {
                                    kind: "line",
                                    npc: "The sun is out.",
                                    npcHasText: true,
                                    isElse: true,
                                    branchKey: "Node001#Nelse",
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        // Top-level block line -> keyed by the state (the node's own line).
        expect(collectMatches(tree, "traveler")).toEqual([{ key: "Node001", stateId: "Node001" }]);
        // Nested lines -> keyed by their branch.
        expect(collectMatches(tree, "moon is high")).toEqual([
            { key: "Node001#Nif", stateId: "Node001", branchKey: "Node001#Nif" },
        ]);
        expect(collectMatches(tree, "sun is out")).toEqual([
            { key: "Node001#Nelse", stateId: "Node001", branchKey: "Node001#Nelse" },
        ]);
    });

    it("is case-insensitive and returns matches in top-to-bottom outline order across nested states", () => {
        const child: ConversationTree["roots"][number] = {
            id: "Node002",
            text: "keyword child line",
            replies: [],
            isEntry: false,
            textEditable: true,
        };
        const tree: ConversationTree = {
            roots: [
                {
                    id: "Node001",
                    text: "keyword parent line",
                    replies: [
                        { ...exitReply("Node001#opt0", "KEYWORD option"), target: { kind: "state", node: child } },
                    ],
                    isEntry: true,
                    textEditable: true,
                },
            ],
        };
        // Parent line, then parent option, then child line - the order they render.
        expect(collectMatches(tree, "keyword")).toEqual([
            { key: "Node001", stateId: "Node001" },
            { key: "Node001#opt0", stateId: "Node001", choiceId: "Node001#opt0" },
            { key: "Node002", stateId: "Node002" },
        ]);
    });
});
