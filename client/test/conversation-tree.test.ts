/**
 * Unit tests for the conversation-flow tree builder and the shared cross-file
 * jump resolver that the graph and tree views both use.
 */
import { describe, expect, it } from "vitest";
import { buildConversationTree, type ConvState, type ConvTarget } from "../src/dialog-editor/webview/conversation-tree";
import { resolveJumpTarget } from "../src/dialog-editor/webview/jump-resolve";
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

describe("resolveJumpTarget", () => {
    const stateToRoot = new Map([
        ["Run", "dialog:CORAN"],
        ["Start", "dialog:NPC"],
    ]);
    const fileToRoot = new Map([["%CORAN_JOINED%", "dialog:CORAN"]]);

    it("resolves a bare state id owned by a root", () => {
        expect(resolveJumpTarget("Run", stateToRoot, fileToRoot)).toEqual({ file: "dialog:CORAN", stateId: "Run" });
    });
    it("resolves a tilde-wrapped file:state EXTERN label", () => {
        expect(resolveJumpTarget("~%CORAN_JOINED%~:Run", stateToRoot, fileToRoot)).toEqual({
            file: "dialog:CORAN",
            stateId: "Run",
        });
    });
    it("returns undefined when the state is not in the named file", () => {
        // Start exists, but under dialog:NPC, not the named %CORAN_JOINED% root.
        expect(resolveJumpTarget("~%CORAN_JOINED%~:Start", stateToRoot, fileToRoot)).toBeUndefined();
    });
    it("returns undefined for an unknown label with no colon", () => {
        expect(resolveJumpTarget("Nope", stateToRoot, fileToRoot)).toBeUndefined();
    });
    it("returns undefined when the file part is unknown", () => {
        expect(resolveJumpTarget("%OTHER%:Run", stateToRoot, fileToRoot)).toBeUndefined();
    });
});

describe("buildConversationTree", () => {
    it("expands a linear chain rooted at the entry, with exit leaf", () => {
        const r = root([
            st("A", "hi", [ch("A#0", { kind: "state", stateId: "B" }, { text: "go" })]),
            st("B", "bye", [ch("B#0", { kind: "exit" })]),
        ]);
        const { roots } = buildConversationTree(r, undefined, noJump);
        expect(roots).toHaveLength(1);
        expect(roots[0]!.id).toBe("A");
        expect(roots[0]!.isEntry).toBe(true);
        const b = roots[0]!.replies[0]!.target as Extract<ConvTarget, { kind: "state" }>;
        expect(b.kind).toBe("state");
        expect(b.node.id).toBe("B");
        expect(b.node.isEntry).toBe(false);
        expect(b.node.replies[0]!.target.kind).toBe("exit");
    });

    it("collapses a cycle: the back-reference becomes a ref leaf, not infinite recursion", () => {
        const r = root([
            st("A", "a", [ch("A#0", { kind: "state", stateId: "B" }, { text: "to b" })]),
            st("B", "b", [ch("B#0", { kind: "state", stateId: "A" }, { text: "back to a" })]),
        ]);
        const { roots } = buildConversationTree(r, undefined, noJump);
        const b = roots[0]!.replies[0]!.target as Extract<ConvTarget, { kind: "state" }>;
        const backToA = b.node.replies[0]!.target;
        expect(backToA).toEqual({ kind: "ref", stateId: "A" });
    });

    it("shows a state reached from two places once (first-expansion-wins), the rest as refs", () => {
        const r = root([
            st("A", "a", [ch("A#0", { kind: "state", stateId: "C" }), ch("A#1", { kind: "state", stateId: "B" })]),
            st("B", "b", [ch("B#0", { kind: "state", stateId: "C" })]),
            st("C", "c", [ch("C#0", { kind: "exit" })]),
        ]);
        const { roots } = buildConversationTree(r, undefined, noJump);
        // A is the only entry (B and C are both targeted).
        expect(roots).toHaveLength(1);
        const a = roots[0]!;
        // A#0 -> C expands first (full node); A#1 -> B; B#0 -> C is now a ref.
        expect((a.replies[0]!.target as { kind: string }).kind).toBe("state");
        const b = a.replies[1]!.target as Extract<ConvTarget, { kind: "state" }>;
        expect(b.node.replies[0]!.target).toEqual({ kind: "ref", stateId: "C" });
    });

    it("treats a goto to a state outside this file as an external leaf, resolving its jump", () => {
        const r = root([st("A", "a", [ch("A#0", { kind: "state", stateId: "Faraway" }, { text: "leave" })])]);
        const { roots } = buildConversationTree(r, undefined, (label) =>
            label === "Faraway" ? { file: "dialog:OTHER", stateId: "Faraway" } : undefined,
        );
        expect(roots[0]!.replies[0]!.target).toEqual({
            kind: "external",
            label: "Faraway",
            jump: { file: "dialog:OTHER", stateId: "Faraway" },
        });
    });

    it("carries external EXTERN targets with their resolved jump", () => {
        const r = root([
            st("A", "a", [ch("A#0", { kind: "external", label: "~%X%~:Y", resolved: true }, { text: "x" })]),
        ]);
        const { roots } = buildConversationTree(r, undefined, () => ({ file: "dialog:X", stateId: "Y" }));
        const t = roots[0]!.replies[0]!.target as Extract<ConvTarget, { kind: "external" }>;
        expect(t.kind).toBe("external");
        expect(t.label).toBe("~%X%~:Y");
        expect(t.jump).toEqual({ file: "dialog:X", stateId: "Y" });
    });

    it("resolves @N refs in NPC line and reply text via messages", () => {
        const r = root([st("A", "@10", [ch("A#0", { kind: "exit" }, { text: "@20" })])]);
        const { roots } = buildConversationTree(r, { "10": "Hello there", "20": "Goodbye" }, noJump);
        expect(roots[0]!.text).toBe("Hello there");
        expect(roots[0]!.replies[0]!.text).toBe("Goodbye");
        expect(roots[0]!.replies[0]!.hasText).toBe(true);
    });

    it("marks a textless transition as a silent continue", () => {
        const r = root([st("A", "a", [ch("A#0", { kind: "exit" })])]);
        const { roots } = buildConversationTree(r, undefined, noJump);
        expect(roots[0]!.replies[0]!.hasText).toBe(false);
        expect(roots[0]!.replies[0]!.text).toBe("");
    });

    it("passes through condition, action, trigger, and derivedFrom", () => {
        const r = root([
            st("A", "a", [ch("A#0", { kind: "exit" }, { condition: "IF x", action: "DO y" })], {
                trigger: "Global",
                derivedFrom: "CHAIN",
            }),
        ]);
        const { roots } = buildConversationTree(r, undefined, noJump);
        expect(roots[0]!.trigger).toBe("Global");
        expect(roots[0]!.derivedFrom).toBe("CHAIN");
        expect(roots[0]!.replies[0]!.condition).toBe("IF x");
        expect(roots[0]!.replies[0]!.action).toBe("DO y");
    });

    it("surfaces a state reachable only inside a cycle as an additional root so every state appears", () => {
        // B <-> C form a cycle with no entry into them; A is the lone entry and does
        // not reach them. The sweep must still surface B (and C via B) once.
        const r = root([
            st("A", "a", [ch("A#0", { kind: "exit" })]),
            st("B", "b", [ch("B#0", { kind: "state", stateId: "C" })]),
            st("C", "c", [ch("C#0", { kind: "state", stateId: "B" })]),
        ]);
        const { roots } = buildConversationTree(r, undefined, noJump);
        const ids = roots.map((s: ConvState) => s.id);
        expect(ids).toContain("A");
        expect(ids).toContain("B");
        // C is expanded under B; B->C is a state node, C->B is a ref.
        const bRoot = roots.find((s: ConvState) => s.id === "B")!;
        expect((bRoot.replies[0]!.target as { kind: string }).kind).toBe("state");
    });

    it("carries the real speaker (D) but not the SSL file-name fallback; the id is always present (shown dimmed)", () => {
        const ssl: DialogState = { id: "Node001", text: "hi", choices: [] };
        const sslRow = buildConversationTree(root([ssl]), undefined, noJump).roots[0]!;
        expect(sslRow.speaker).toBeUndefined(); // SSL: no speaker -> tree shows only the dimmed id
        expect(sslRow.id).toBe("Node001");
        const d: DialogState = { id: "VISK1", speaker: "Viconia", text: "hi", choices: [] };
        expect(buildConversationTree(root([d]), undefined, noJump).roots[0]!.speaker).toBe("Viconia");
    });

    it("returns no roots for an empty dialog", () => {
        expect(buildConversationTree(root([]), undefined, noJump).roots).toHaveLength(0);
    });

    it("represents a bundle (if/else) node as branches, each with its own NPC line and replies", () => {
        const r = root([
            st(
                "Hub",
                "@10", // the if-branch line; the else line must NOT be lost
                [
                    ch("Hub#opt0", { kind: "state", stateId: "A" }, { text: "ask", condition: "X==0" }),
                    ch("Hub#opt1", { kind: "exit" }, { text: "leave", condition: "!(X==0)" }),
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
            st("A", "@30", [ch("A#0", { kind: "exit" })]),
        ]);
        const messages = { "10": "First-time line", "20": "Later line", "30": "A line" };
        const hub = buildConversationTree(r, messages, noJump).roots[0]!;
        expect(hub.branches).toHaveLength(2);
        expect(hub.branches![0]!.kind).toBe("if");
        expect(hub.branches![0]!.condition).toBe("X==0");
        expect(hub.branches![0]!.npc).toBe("First-time line");
        expect(hub.branches![0]!.replies.map((rp) => rp.id)).toEqual(["Hub#opt0"]);
        expect(hub.branches![1]!.kind).toBe("else");
        expect(hub.branches![1]!.npc).toBe("Later line"); // the else NPC line is preserved, not dropped
        expect(hub.branches![1]!.replies.map((rp) => rp.id)).toEqual(["Hub#opt1"]);
        // Replies live per branch, so the flat list is empty (no double-expansion).
        expect(hub.replies).toHaveLength(0);
        // A branch option still expands its target sub-tree.
        const aTarget = hub.branches![0]!.replies[0]!.target as Extract<ConvTarget, { kind: "state" }>;
        expect(aTarget.node.id).toBe("A");
    });
});
