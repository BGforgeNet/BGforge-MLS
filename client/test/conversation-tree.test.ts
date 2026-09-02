/**
 * Unit tests for the conversation-flow tree builder and the shared cross-file
 * jump resolver that the graph and tree views both use.
 */
import { describe, expect, it } from "vitest";
import {
    buildConversationTree,
    childStates,
    type ConvState,
    type ConvTarget,
} from "../src/dialog-editor/webview/conversation-tree";
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

    it("carries every SAY line of a multisay state (continuation lines resolved), so none are hidden", () => {
        // A WeiDU D `SAY @10 = @20 = @30` monologue: the model keeps all three in sayTexts. The tree must
        // surface lines 2..N (they were invisible - shown first-line-only) as `sayLines`, line 0 stays `text`.
        const r = root([st("A", "@10", [ch("A#0", { kind: "exit" })], { sayTexts: ["@10", "@20", "@30"] })]);
        const { roots } = buildConversationTree(
            r,
            { "10": "First line.", "20": "Second line.", "30": "Third." },
            noJump,
        );
        expect(roots[0]!.text).toBe("First line.");
        expect(roots[0]!.sayLines).toEqual(["Second line.", "Third."]);
    });

    it("flags a pending (not-yet-in-source) state and option, and leaves a committed one unflagged", () => {
        // A pending item is in the webview's optimistic model but has no source span yet (a just-added node/option
        // before the reparse adopts it, or an empty option deferred until its text commits). The view marks it as
        // an unsaved draft. A committed item carries a source span (procRange/sourceRange, callRange).
        const r = root([
            st(
                "A",
                "hi",
                [ch("A#0", { kind: "state", stateId: "New" }, { text: "go", callRange: { start: 0, end: 1 } })],
                {
                    sourceRange: { start: 0, end: 10 },
                },
            ),
            st("New", "a new line", [ch("New#0", { kind: "exit" }, { text: "" })]), // no source span -> pending
        ]);
        const { roots } = buildConversationTree(r, undefined, noJump);
        const a = roots[0]!;
        expect(a.pending).toBeUndefined(); // committed (has sourceRange)
        expect(a.replies[0]!.pending).toBeUndefined(); // committed option (has callRange)
        const newState = (a.replies[0]!.target as Extract<ConvTarget, { kind: "state" }>).node;
        expect(newState.pending).toBe(true); // pending state (no source span)
        expect(newState.replies[0]!.pending).toBe(true); // pending option (no source span)
    });

    it("leaves sayLines absent for a single-say state", () => {
        const r = root([st("A", "@10", [ch("A#0", { kind: "exit" })])]);
        const { roots } = buildConversationTree(r, { "10": "Only line." }, noJump);
        expect(roots[0]!.sayLines).toBeUndefined();
    });

    it("marks a textless transition as a silent continue", () => {
        const r = root([st("A", "a", [ch("A#0", { kind: "exit" })])]);
        const { roots } = buildConversationTree(r, undefined, noJump);
        expect(roots[0]!.replies[0]!.hasText).toBe(false);
        expect(roots[0]!.replies[0]!.text).toBe("");
    });

    // textEditable drives whether the tree offers inline text editing on an option; it mirrors the
    // inspector's textFieldLocked gate (SSL @N resolvability, read-only/derived states, pending-new).
    it("marks a D literal option's text as editable", () => {
        const r = root([st("A", "a", [ch("A#0", { kind: "exit" }, { text: "hi" })])]);
        const { roots } = buildConversationTree(r, undefined, noJump, { ssl: false, fieldEditable: () => true });
        expect(roots[0]!.replies[0]!.textEditable).toBe(true);
    });

    it("locks option text on a derived (read-only) state", () => {
        const r = root([st("A", "a", [ch("A#0", { kind: "exit" }, { text: "hi" })], { derivedFrom: "CHAIN" })]);
        const { roots } = buildConversationTree(r, undefined, noJump, { ssl: false, fieldEditable: () => true });
        expect(roots[0]!.replies[0]!.textEditable).toBe(false);
    });

    it("locks option text in a view-only (non-editable) D file", () => {
        const r = root([st("A", "a", [ch("A#0", { kind: "exit" }, { text: "hi" })])]);
        const { roots } = buildConversationTree(r, undefined, noJump, { ssl: false, fieldEditable: () => false });
        expect(roots[0]!.replies[0]!.textEditable).toBe(false);
    });

    // Parity fix: the tree honors the PER-STATE fieldEditable predicate, not the model-level flag. A .td file
    // sets model.editable=false but each non-derived state is field-editable, so the inspector treats its text
    // as editable; the tree used to lock it (it consumed the model-level `editable`), diverging from the
    // inspector. With the per-state predicate the two agree.
    it("honors a per-state field-editable predicate (a .td state editable in the inspector is editable in the tree)", () => {
        const r = root([
            st("A", "hi", [ch("A#0", { kind: "exit" }, { text: "reply" })]), // field-editable per the predicate
            st("B", "bye", [ch("B#0", { kind: "exit" }, { text: "reply" })], { derivedFrom: "CHAIN" }), // derived: still locked
        ]);
        const { roots } = buildConversationTree(r, undefined, noJump, {
            ssl: false,
            fieldEditable: (s) => !s.derivedFrom, // the .td gate: every non-derived state is field-editable
        });
        const byId = new Map(roots.map((n) => [n.id, n]));
        expect(byId.get("A")!.textEditable).toBe(true); // was false under the model-level flag - the bug
        expect(byId.get("A")!.replies[0]!.textEditable).toBe(true);
        expect(byId.get("B")!.textEditable).toBe(false); // derived stays read-only
    });

    it("SSL: an option backed by a resolvable @N is editable; a non-resolvable one is locked", () => {
        const r = root([
            st("A", "a", [
                // stmtRange marks these existing-in-source (not pending-new), so the @N-resolvability
                // gate applies rather than the pending-new exemption.
                ch("A#0", { kind: "exit" }, { text: "@10", stmtRange: { start: 0, end: 1 } }), // resolves in messages
                ch("A#1", { kind: "exit" }, { text: "@99", stmtRange: { start: 2, end: 3 } }), // no .msg entry - nowhere to write
            ]),
        ]);
        const { roots } = buildConversationTree(r, { "10": "Hi" }, noJump, { ssl: true, fieldEditable: () => false });
        expect(roots[0]!.replies[0]!.textEditable).toBe(true);
        expect(roots[0]!.replies[1]!.textEditable).toBe(false);
    });

    it("SSL: a just-added (pending) option is editable even before it has an @N", () => {
        const r = root([st("A", "a", [ch("A#0", { kind: "exit" }, { text: "" })])]);
        const { roots } = buildConversationTree(r, {}, noJump, { ssl: true, fieldEditable: () => false });
        expect(roots[0]!.replies[0]!.textEditable).toBe(true);
    });

    // ConvState.textEditable mirrors ConvReply.textEditable for the NPC line: it applies the inspector's
    // textFieldLocked gate to the state's OWN text, driving inline NPC-line editing in the tree.
    it("marks a D literal NPC line as editable", () => {
        const r = root([st("A", "hi", [])]);
        const { roots } = buildConversationTree(r, undefined, noJump, { ssl: false, fieldEditable: () => true });
        expect(roots[0]!.textEditable).toBe(true);
    });

    it("locks the NPC line on a derived (read-only) state", () => {
        const r = root([st("A", "hi", [], { derivedFrom: "CHAIN" })]);
        const { roots } = buildConversationTree(r, undefined, noJump, { ssl: false, fieldEditable: () => true });
        expect(roots[0]!.textEditable).toBe(false);
    });

    it("locks the NPC line in a view-only (non-editable) D file", () => {
        const r = root([st("A", "hi", [])]);
        const { roots } = buildConversationTree(r, undefined, noJump, { ssl: false, fieldEditable: () => false });
        expect(roots[0]!.textEditable).toBe(false);
    });

    it("SSL: an NPC line backed by a resolvable @N is editable; a non-resolvable one is locked", () => {
        const r = root([
            // procRange marks these existing-in-source (not pending-new), so the @N-resolvability gate applies.
            st("Node001", "@10", [], { procRange: { start: 0, end: 1 } }), // resolves in messages
            st("Node002", "@99", [], { procRange: { start: 2, end: 3 } }), // no .msg entry - nowhere to write
        ]);
        const { roots } = buildConversationTree(r, { "10": "Hi" }, noJump, { ssl: true, fieldEditable: () => false });
        const byId = new Map(roots.map((n) => [n.id, n]));
        expect(byId.get("Node001")!.textEditable).toBe(true);
        expect(byId.get("Node002")!.textEditable).toBe(false);
    });

    it("SSL: a just-added (pending) state's NPC line is editable even before it has an @N", () => {
        const r = root([st("A", "", [])]);
        const { roots } = buildConversationTree(r, {}, noJump, { ssl: true, fieldEditable: () => false });
        expect(roots[0]!.textEditable).toBe(true);
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

    // Go-to-source (F4): the option row carries the byte offset of its source statement. SSL options carry
    // callRange/stmtRange/callSite spans; a WeiDU D option carries only `sourceRange`. Both must resolve, and a
    // pending (just-added) option - which has no span yet - stays undefined so F4 is a no-op on it.
    describe("option sourceOffset (go to source)", () => {
        const offsetOf = (choice: DialogChoice): number | undefined =>
            buildConversationTree(root([st("A", "@0", [choice])]), undefined, noJump).roots[0]!.replies[0]!
                .sourceOffset;

        it("resolves a WeiDU D option from its sourceRange (the SSL span fields are absent for D)", () => {
            expect(offsetOf(ch("A#0", { kind: "exit" }, { sourceRange: { start: 128, end: 160 } }))).toBe(128);
        });
        it("prefers the SSL callRange over sourceRange when both somehow exist", () => {
            const c = ch(
                "A#opt0",
                { kind: "exit" },
                { callRange: { start: 40, end: 70 }, sourceRange: { start: 128, end: 160 } },
            );
            expect(offsetOf(c)).toBe(40);
        });
        it("falls back through stmtRange then the first call site", () => {
            expect(offsetOf(ch("A#opt0", { kind: "exit" }, { stmtRange: { start: 55, end: 80 } }))).toBe(55);
            const call = ch(
                "A#call0",
                { kind: "state", stateId: "B" },
                { callSites: [{ stmtRange: { start: 12, end: 30 }, topLevel: true }] },
            );
            expect(offsetOf(call)).toBe(12);
        });
        it("is undefined for a pending (just-added) option with no source span yet", () => {
            expect(offsetOf(ch("A#reply", { kind: "exit" }, { text: "@5" }))).toBeUndefined();
        });
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

// SSL convention: Node999 is the end/leave node (Exit), Node998 the combat node. The tree presents an option
// targeting them as a terminal chip - not a link to a drawn node - and carries the underlying id as a tooltip.
// The model target stays state->Node99x (round-trips), so this is a pure presentation fold, SSL-only.
describe("buildConversationTree - Node998/Node999 as Combat/Exit terminals (SSL)", () => {
    it("folds a Node999 target to Exit and a Node998 target to Combat, each with its id tooltip, and draws neither node", () => {
        const r = root([
            st("Node001", "Hello.", [
                ch("Node001#0", { kind: "state", stateId: "Node999" }, { text: "Leave." }),
                ch("Node001#1", { kind: "state", stateId: "Node998" }, { text: "Attack!" }),
            ]),
            st("Node998", "", []),
            st("Node999", "", []),
        ]);
        const { roots } = buildConversationTree(r, undefined, noJump, { ssl: true, fieldEditable: () => false });
        // Only the real node is drawn; the two support nodes are terminals, not conversation nodes.
        expect(roots.map((n) => n.id)).toEqual(["Node001"]);
        expect(roots[0]!.replies[0]!.target).toEqual({ kind: "exit", nodeId: "Node999" });
        expect(roots[0]!.replies[1]!.target).toEqual({ kind: "combat", nodeId: "Node998" });
    });

    it("leaves a Node999 target a normal state link for non-SSL formats (the convention is SSL-only)", () => {
        const r = root([
            st("A", "Hello.", [ch("A#0", { kind: "state", stateId: "Node999" }, { text: "Leave." })]),
            st("Node999", "end", []),
        ]);
        const { roots } = buildConversationTree(r, undefined, noJump, { ssl: false, fieldEditable: () => true });
        const t = roots[0]!.replies[0]!.target;
        expect(t.kind).toBe("state");
        expect((t as Extract<ConvTarget, { kind: "state" }>).node.id).toBe("Node999");
    });

    // A `structured` SSL node (arbitrarily nested if/else): the builder mirrors the source nesting as a
    // recursive ConvBlock, with each condition shown once at its own group level and the else line preserved -
    // instead of the flat projection that dropped outer gates (dialog-nested-flatten-bug-class).
    it("builds a recursive ConvBlock from a structured node's block", () => {
        const r = root([
            st(
                "N1",
                "@1",
                [
                    ch("N1#opt0", { kind: "state", stateId: "B" }, { text: "@10", condition: "(OUTER)" }),
                    ch("N1#opt1", { kind: "state", stateId: "C" }, { text: "@11", condition: "(OUTER) and (INNER)" }),
                    ch("N1#opt2", { kind: "state", stateId: "D" }, { text: "@12", condition: "not (OUTER)" }),
                    ch("N1#opt3", { kind: "exit" }, { text: "@13" }),
                ],
                {
                    structured: true,
                    block: [
                        {
                            kind: "group",
                            condition: "(OUTER)",
                            thenBlock: [
                                { kind: "line", text: "@100" },
                                { kind: "choice", choiceId: "N1#opt0" },
                                {
                                    kind: "group",
                                    condition: "(INNER)",
                                    thenBlock: [{ kind: "choice", choiceId: "N1#opt1" }],
                                },
                            ],
                            elseBlock: [
                                { kind: "line", text: "@200" },
                                { kind: "choice", choiceId: "N1#opt2" },
                            ],
                        },
                        { kind: "choice", choiceId: "N1#opt3" },
                    ],
                },
            ),
            st("B", "@2", []),
            st("C", "@3", []),
            st("D", "@4", []),
        ]);
        const { roots } = buildConversationTree(r, undefined, noJump, { ssl: true, fieldEditable: () => false });
        const n1 = roots.find((s) => s.id === "N1")!;
        const block = n1.block!;
        expect(block).toBeDefined();

        // Top level: the if/else group, then the unconditional trailing option.
        const group = block[0] as Extract<(typeof block)[number], { kind: "group" }>;
        expect(group.kind).toBe("group");
        expect(group.condition).toBe("(OUTER)");
        expect(block[1]).toMatchObject({ kind: "reply" });

        // then-branch: its own NPC line, an option, and a NESTED group (each condition once at its level).
        expect(group.thenBlock[0]).toMatchObject({ kind: "line", npc: "@100" });
        const inner = group.thenBlock.find((item) => item.kind === "group") as Extract<
            (typeof group.thenBlock)[number],
            { kind: "group" }
        >;
        expect(inner.condition).toBe("(INNER)");
        expect(inner.thenBlock).toHaveLength(1);
        expect(inner.thenBlock[0]).toMatchObject({ kind: "reply" });

        // else-branch carries its OWN NPC line (the flat projection dropped it - symptom 3), tagged `isElse`
        // (so the tree labels it `[else]`, not `[if]`) with the negated condition in its tooltip. The if-branch
        // line is NOT tagged.
        expect(group.elseBlock).toBeDefined();
        expect(group.elseBlock![0]).toMatchObject({
            kind: "line",
            npc: "@200",
            isElse: true,
            condition: "not (OUTER)",
        });
        expect(group.thenBlock[0]).toMatchObject({ kind: "line", npc: "@100" });
        expect((group.thenBlock[0] as { isElse?: boolean }).isElse).toBeUndefined();

        // Every choice is expanded exactly once through the block (no flat replies duplicating them).
        expect(n1.replies).toHaveLength(0);

        // Branch keys drive the tree's branch highlight: each row carries the key of the innermost branch it
        // sits in, a nested branch's key STARTS WITH its parent's, and a top-level (unbranched) row is unkeyed.
        const thenLine = group.thenBlock[0] as { branchKey?: string };
        const elseLine = group.elseBlock![0] as { branchKey?: string };
        expect(thenLine.branchKey).toBe("N1#0if");
        expect(elseLine.branchKey).toBe("N1#0else");
        // opt2 sits directly in the else branch; opt1 sits in a nested if UNDER the then branch.
        const elseOpt = group.elseBlock!.find((item) => item.kind === "reply")! as { reply: { branchKey?: string } };
        expect(elseOpt.reply.branchKey).toBe("N1#0else");
        const nestedGroup = group.thenBlock.find((item) => item.kind === "group")! as {
            thenBlock: { kind: string; reply?: { branchKey?: string } }[];
        };
        const nestedOpt = nestedGroup.thenBlock.find((item) => item.kind === "reply")!;
        expect(nestedOpt.reply!.branchKey).toBe("N1#0if.0if");
        expect(nestedOpt.reply!.branchKey!.startsWith("N1#0if")).toBe(true); // covered by highlighting the then branch
        // The unconditional trailing option (block[1]) is not in any branch -> unkeyed, so a branch highlight
        // never covers it.
        expect((block[1] as { reply: { branchKey?: string } }).reply.branchKey).toBeUndefined();
    });

    // An approximate node (control flow the block can't model) renders flat but must carry the flag through
    // to ConvState so the tree shows the loud "approx" warning badge (dialog-nested-flatten-bug-class dec. 3).
    it("carries the approximate flag onto ConvState", () => {
        const r = root([st("A", "@1", [ch("A#0", { kind: "exit" }, { text: "@2" })], { approximate: true })]);
        const { roots } = buildConversationTree(r, undefined, noJump, { ssl: true, fieldEditable: () => false });
        expect(roots[0]!.approximate).toBe(true);
        // A normal node does not get the flag.
        const r2 = root([st("B", "@1", [ch("B#0", { kind: "exit" })])]);
        expect(
            buildConversationTree(r2, undefined, noJump, { ssl: true, fieldEditable: () => false }).roots[0]!
                .approximate,
        ).toBeUndefined();
    });
});

describe("childStates (shared tree traversal)", () => {
    it("finds a branch node's reply target, which a flat-only walk misses", () => {
        // A bundle (if/else) node keeps its replies per branch, so its flat `replies` is empty. A traversal that
        // only walked flat replies (the old reveal/collapse-all walks) missed the branch reply's child state.
        const r = root([
            st("Hub", "@10", [ch("Hub#opt0", { kind: "state", stateId: "A" }, { text: "ask", condition: "X==0" })], {
                branches: [
                    { kind: "if", condition: "X==0", replies: [{ text: "@10" }], choiceIds: ["Hub#opt0"], opaque: [] },
                ],
            }),
            st("A", "@30", [ch("A#0", { kind: "exit" })]),
        ]);
        const hub = buildConversationTree(r, { "10": "line", "30": "a" }, noJump).roots[0]!;
        expect(hub.replies).toHaveLength(0); // branch node: no flat replies for a flat-only walk to find
        expect(childStates(hub).map((c) => c.id)).toEqual(["A"]);
    });
});

describe("a format with no source spans at all", () => {
    // Found by driving a real .dlg: every node showed the amber "unsaved" badge. `isPendingState` reads a
    // missing span as "the user just added this", which holds for text-backed formats and is false for a
    // compiled DLG, where NO state has a span and nothing is editable. Absence of a span means "just added"
    // only where spans exist at all, so the format has to say which case it is.
    const r = root([st("0", "hi", [ch("0#0", { kind: "exit" }, { text: "bye" })])]);

    it("marks a span-less state pending when the format normally has spans", () => {
        const { roots } = buildConversationTree(r, undefined, noJump, { ssl: false, fieldEditable: () => true });

        expect(roots[0]!.pending).toBe(true);
    });

    it("marks nothing pending when the format has no spans to be missing", () => {
        const { roots } = buildConversationTree(r, undefined, noJump, {
            ssl: false,
            fieldEditable: () => true,
            sourceless: true,
        });

        expect(roots[0]!.pending).toBeUndefined();
        expect(roots[0]!.replies[0]!.pending).toBeUndefined();
    });
});

describe("a derived state in a format that does have spans", () => {
    // The sibling of the sourceless case above, found by driving BG1NPC's p#corlt.d: all 9 CHAIN-derived
    // states wore the amber "unsaved draft" accent, against 0 of the 686 authored ones. A derived state is
    // synthesised from a CHAIN/INTERJECT/EXTEND written elsewhere, so it legitimately has no span of its own -
    // which `isPendingState` alone reads as "the user just added this". It is in the source, just not here.
    const derived = root([
        st("chained", "hi", [ch("chained#0", { kind: "exit" }, { text: "bye" })], { derivedFrom: "CHAIN" }),
    ]);

    it("does not mark a derived state as an unsaved draft", () => {
        const { roots } = buildConversationTree(derived, undefined, noJump, { ssl: false, fieldEditable: () => true });

        expect(roots[0]!.pending).toBeUndefined();
    });

    it("does not mark a derived state's options as unsaved drafts", () => {
        const { roots } = buildConversationTree(derived, undefined, noJump, { ssl: false, fieldEditable: () => true });

        expect(roots[0]!.replies[0]!.pending).toBeUndefined();
    });

    it("still marks a genuinely just-added state pending", () => {
        // The guard against over-fixing: absence of a span with no derivedFrom really is a new node.
        const fresh = root([st("new", "hi", [ch("new#0", { kind: "exit" }, { text: "bye" })])]);

        const { roots } = buildConversationTree(fresh, undefined, noJump, { ssl: false, fieldEditable: () => true });

        expect(roots[0]!.pending).toBe(true);
        expect(roots[0]!.replies[0]!.pending).toBe(true);
    });
});
