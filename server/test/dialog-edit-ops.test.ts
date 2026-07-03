import { beforeAll, describe, expect, it } from "vitest";
import { initParser } from "../../shared/parsers/weidu-d";
import { parseDDialog } from "../src/weidu-d/dialog";
import {
    modelFromD,
    type DialogBranch,
    type DialogChoice,
    type DialogModel,
    type DialogState,
} from "../../shared/dialog-model";
import { applyDialogEdits } from "../../shared/dialog-d-edit";
import * as ops from "../../shared/dialog-edit-ops";

const SRC = `APPEND ~coranj~
IF ~~ THEN BEGIN hello SAY ~Hi.~ IF ~~ THEN REPLY ~more~ GOTO more IF ~~ THEN REPLY ~bye~ EXIT END
IF ~~ THEN BEGIN more SAY ~More.~ IF ~~ THEN EXIT END
END
`;

describe("dialog-edit-ops (pure model transforms)", () => {
    beforeAll(async () => {
        await initParser();
    });

    function model() {
        return modelFromD(parseDDialog(SRC));
    }
    function state(m: ReturnType<typeof model>, id: string) {
        return m.roots.flatMap((r) => r.states).find((s) => s.id === id)!;
    }

    it("renames a state and moves every GOTO reference with it", () => {
        const m = model();
        expect(ops.renameState(m, state(m, "more"), "later")).toBe(true);
        expect(state(m, "later")).toBeDefined();
        // hello's first choice pointed at `more`; it must now point at `later`.
        const hello = state(m, "hello");
        expect(hello.choices[0]!.target).toEqual({ kind: "state", stateId: "later" });
    });

    it("rejects a rename to an already-used label", () => {
        const m = model();
        expect(ops.renameState(m, state(m, "more"), "hello")).toBe(false);
        expect(state(m, "more").id).toBe("more");
    });

    it("deletes a state and redirects inbound references to EXIT", () => {
        const m = model();
        ops.deleteState(m, state(m, "more"));
        expect(m.roots.flatMap((r) => r.states).some((s) => s.id === "more")).toBe(false);
        expect(state(m, "hello").choices[0]!.target).toEqual({ kind: "exit" });
    });

    it("counts inbound GOTOs so a delete can warn before redirecting them to EXIT", () => {
        const m = model();
        // `hello`'s first reply does GOTO more; nothing points at `hello`.
        expect(ops.countInboundGotos(m, state(m, "more"))).toBe(1);
        expect(ops.countInboundGotos(m, state(m, "hello"))).toBe(0);
    });

    // A GOTO resolves WITHIN one dialogue (BEGIN block / resref). When two dialogues in the same .d file each
    // define a same-named state and each GOTOs its own copy, an edit to one dialogue's state must not touch the
    // other's identically-named state or its GOTO.
    const CROSS_GOTO = `BEGIN ~first~
IF ~~ THEN BEGIN a SAY ~A1~ IF ~~ THEN REPLY ~go~ GOTO shared END
IF ~~ THEN BEGIN shared SAY ~First shared~ IF ~~ THEN EXIT END
END

BEGIN ~second~
IF ~~ THEN BEGIN b SAY ~B1~ IF ~~ THEN REPLY ~go~ GOTO shared END
IF ~~ THEN BEGIN shared SAY ~Second shared~ IF ~~ THEN EXIT END
END
`;
    const crossModel = () => modelFromD(parseDDialog(CROSS_GOTO));
    const inRoot = (m: DialogModel, label: string, id: string) =>
        m.roots.find((r) => r.label === label)!.states.find((s) => s.id === id)!;

    it("renameState moves only same-dialogue GOTOs, not a same-named state in another dialogue", () => {
        const m = crossModel();
        ops.renameState(m, inRoot(m, "first", "shared"), "shared_x");
        expect(inRoot(m, "first", "a").choices[0]!.target).toEqual({ kind: "state", stateId: "shared_x" });
        expect(inRoot(m, "second", "b").choices[0]!.target).toEqual({ kind: "state", stateId: "shared" });
    });

    it("deleteState redirects only same-dialogue inbound GOTOs to EXIT", () => {
        const m = crossModel();
        ops.deleteState(m, inRoot(m, "first", "shared"));
        expect(inRoot(m, "first", "a").choices[0]!.target).toEqual({ kind: "exit" });
        expect(inRoot(m, "second", "b").choices[0]!.target).toEqual({ kind: "state", stateId: "shared" });
    });

    it("countInboundGotos counts only same-dialogue inbound GOTOs", () => {
        const m = crossModel();
        expect(ops.countInboundGotos(m, inRoot(m, "first", "shared"))).toBe(1); // only first's `a`
    });

    it("duplicates a state with a fresh id and NO sourceRange (so save cannot clobber the original)", () => {
        const m = model();
        const original = state(m, "hello");
        expect(original.sourceRange).toBeDefined();
        const copy = ops.duplicateState(m, original)!;
        expect(copy.id).toBe("hello_copy");
        expect(copy.sourceRange).toBeUndefined();
        // The copy must surface as a pending insert, never spliced over the original span.
        expect(ops.duplicateState(m, original)!.id).toBe("hello_copy_1"); // unique on repeat
    });

    it("a duplicated state does not corrupt the original on surgical save", () => {
        const m = model();
        ops.duplicateState(m, state(m, "hello"));
        const out = applyDialogEdits(SRC, m);
        // The original `hello` block is untouched (the copy has no sourceRange to splice).
        expect(out).toContain("BEGIN hello");
        expect((out.match(/BEGIN hello\b/g) ?? []).length).toBe(1);
    });

    it("inserts a newly-added state on save, after its siblings, re-parseable", () => {
        const m = model();
        const added = ops.addState(m)!;
        added.id = "fresh"; // (rename is tested elsewhere; just give it a readable id)
        // retarget the rename's ref pass is irrelevant here; set content directly
        added.text = "A new line.";
        added.choices.push({ id: "fresh#0", text: "ok", target: { kind: "exit" } });
        const out = applyDialogEdits(SRC, m);
        expect(out).toContain("BEGIN fresh");
        // Original states + comment-free structure preserved; re-parse round-trips the new state.
        const reparsed = modelFromD(parseDDialog(out));
        const freshAgain = reparsed.roots.flatMap((r) => r.states).find((s) => s.id === "fresh");
        expect(freshAgain?.text).toBe("A new line.");
        expect(state(reparsed, "hello")).toBeDefined();
        expect(state(reparsed, "more")).toBeDefined();
    });

    it("names a new SSL node NodeNNN (next free), not new_state", () => {
        const m: DialogModel = {
            format: "fallout-ssl",
            editable: false,
            roots: [
                {
                    id: "d",
                    label: "d",
                    kind: "dialog",
                    states: [
                        { id: "Node001", text: "@1", procRange: { start: 0, end: 1 }, choices: [] },
                        { id: "Node003", text: "@2", procRange: { start: 2, end: 3 }, choices: [] },
                    ],
                },
            ],
        };
        const s = ops.addState(m);
        expect(s!.id).toBe("Node004"); // max(Node001, Node003) + 1, zero-padded to 3
    });

    it("skips the reserved Node998/Node999 sink range when naming a new SSL node", () => {
        // Node999 (end-dialog) and Node998 (combat/hostile) are reserved sinks. Counting them toward the max
        // hands out Node1000 even though low ids are free (the reported bug). A new node must take the next
        // free id among the real (non-reserved) nodes.
        const m: DialogModel = {
            format: "fallout-ssl",
            editable: false,
            roots: [
                {
                    id: "d",
                    label: "d",
                    kind: "dialog",
                    states: [
                        { id: "Node001", text: "@1", procRange: { start: 0, end: 1 }, choices: [] },
                        { id: "Node003", text: "@2", procRange: { start: 2, end: 3 }, choices: [] },
                        { id: "Node999", text: "@3", procRange: { start: 4, end: 5 }, choices: [] },
                    ],
                },
            ],
        };
        expect(ops.addState(m)!.id).toBe("Node004"); // Node999 ignored -> Node004, not Node1000
    });

    it("never allocates a reserved id: after Node997 the next node jumps past 998/999 to Node1000", () => {
        const m: DialogModel = {
            format: "fallout-ssl",
            editable: false,
            roots: [
                {
                    id: "d",
                    label: "d",
                    kind: "dialog",
                    states: [{ id: "Node997", text: "@1", procRange: { start: 0, end: 1 }, choices: [] }],
                },
            ],
        };
        expect(ops.addState(m)!.id).toBe("Node1000"); // 998 and 999 are reserved, so skip past them
    });

    it("adds/removes/reorders replies and retargets", () => {
        const m = model();
        const hello = state(m, "hello");
        const before = hello.choices.length;
        const added = ops.addReply(m, hello);
        expect(hello.choices.length).toBe(before + 1);
        ops.setChoiceTarget(hello, added.id, { kind: "state", stateId: "more" });
        expect(hello.choices.at(-1)!.target).toEqual({ kind: "state", stateId: "more" });
        ops.moveReply(hello, hello.choices[0]!.id, 1);
        expect(hello.choices[1]!.id).toBe(`hello#0`);
        ops.removeReply(hello, added.id);
        expect(hello.choices.length).toBe(before);
    });
});

// ---------------------------------------------------------------------------
// Branch-aware ops: addReplyToBranch / removeReplyFromBranch / moveReplyInBranch
// ---------------------------------------------------------------------------

describe("dialog-edit-ops (branch-aware)", () => {
    /** Build a synthetic bundle model: Node001 has two branches (if/else) with two choices each. */
    function bundleFixture(): {
        m: DialogModel;
        st: DialogState;
        brA: DialogBranch;
        brB: DialogBranch;
    } {
        const c0: DialogChoice = {
            id: "Node001#opt0",
            text: "a0",
            target: { kind: "exit" },
            condition: "(EvalUGlobal==0)",
        };
        const c1: DialogChoice = {
            id: "Node001#opt1",
            text: "a1",
            target: { kind: "exit" },
            condition: "(EvalUGlobal==0)",
        };
        const c2: DialogChoice = { id: "Node001#opt2", text: "b0", target: { kind: "exit" } };
        const c3: DialogChoice = { id: "Node001#opt3", text: "b1", target: { kind: "exit" } };

        const brA: DialogBranch = {
            kind: "if",
            condition: "(EvalUGlobal==0)",
            replies: [],
            choiceIds: ["Node001#opt0", "Node001#opt1"],
            opaque: [],
        };
        const brB: DialogBranch = {
            kind: "else",
            replies: [],
            choiceIds: ["Node001#opt2", "Node001#opt3"],
            opaque: [],
        };

        const st: DialogState = {
            id: "Node001",
            text: "@1",
            choices: [c0, c1, c2, c3],
            branches: [brA, brB],
        };

        const m: DialogModel = {
            format: "fallout-ssl",
            editable: true,
            roots: [{ id: "d", label: "d", kind: "dialog", states: [st] }],
        };
        return { m, st, brA, brB };
    }

    it("addReplyToBranch appends to branch.choiceIds and state.choices with condition === branch.condition", () => {
        const { m, st, brA } = bundleFixture();
        const before = st.choices.length;
        const added = ops.addReplyToBranch(m, st, brA);

        expect(brA.choiceIds.at(-1)).toBe(added.id);
        expect(st.choices.at(-1)).toBe(added);
        expect(st.choices.length).toBe(before + 1);
        expect(added.condition).toBe(brA.condition);
    });

    it("addReplyToBranch on an else branch produces a choice without condition", () => {
        const { m, st, brB } = bundleFixture();
        const added = ops.addReplyToBranch(m, st, brB);

        expect(brB.choiceIds.at(-1)).toBe(added.id);
        expect(st.choices.at(-1)).toBe(added);
        expect(added.condition).toBeUndefined();
    });

    it("addReplyToBranch allocates a unique id distinct from all existing choice ids", () => {
        const { m, st, brA } = bundleFixture();
        const existingIds = new Set(st.choices.map((c) => c.id));
        const added = ops.addReplyToBranch(m, st, brA);

        expect(existingIds.has(added.id)).toBe(false);
    });

    it("removeReplyFromBranch drops the choice from both state.choices and branch.choiceIds", () => {
        const { st, brA } = bundleFixture();
        const target = brA.choiceIds[0]!;
        ops.removeReplyFromBranch(st, brA, target);

        expect(st.choices.find((c) => c.id === target)).toBeUndefined();
        expect(brA.choiceIds.includes(target)).toBe(false);
        // sibling and other-branch choices untouched
        expect(brA.choiceIds.length).toBe(1);
        expect(st.choices.filter((c) => c.id.startsWith("Node001#opt")).length).toBe(3);
    });

    it("removeReplyFromBranch does not affect the other branch", () => {
        const { st, brA, brB } = bundleFixture();
        ops.removeReplyFromBranch(st, brA, brA.choiceIds[0]!);

        expect(brB.choiceIds.length).toBe(2);
        expect(st.choices.some((c) => c.id === brB.choiceIds[0]!)).toBe(true);
    });

    it("moveReplyInBranch swaps within branch.choiceIds and mirrors order into state.choices", () => {
        const { st, brA } = bundleFixture();
        const [id0, id1] = brA.choiceIds as [string, string];

        ops.moveReplyInBranch(st, brA, id0, 1);

        expect(brA.choiceIds[0]).toBe(id1);
        expect(brA.choiceIds[1]).toBe(id0);
        // The flat choices array must reflect the same swap for brA's slots (indices 0 and 1).
        expect(st.choices[0]!.id).toBe(id1);
        expect(st.choices[1]!.id).toBe(id0);
        // brB's choices at indices 2 and 3 must be untouched.
        expect(st.choices[2]!.id).toBe("Node001#opt2");
        expect(st.choices[3]!.id).toBe("Node001#opt3");
    });

    it("moveReplyInBranch is a no-op at the branch's first position (up)", () => {
        const { st, brA } = bundleFixture();
        const snapshot = [...brA.choiceIds];

        ops.moveReplyInBranch(st, brA, brA.choiceIds[0]!, -1);

        expect(brA.choiceIds).toEqual(snapshot);
        expect(st.choices[0]!.id).toBe(snapshot[0]);
    });

    it("moveReplyInBranch is a no-op at the branch's last position (down)", () => {
        const { st, brA } = bundleFixture();
        const snapshot = [...brA.choiceIds];

        ops.moveReplyInBranch(st, brA, brA.choiceIds[1]!, 1);

        expect(brA.choiceIds).toEqual(snapshot);
        expect(st.choices[1]!.id).toBe(snapshot[1]);
    });

    it("moveReplyInBranch does not cross into the adjacent branch's choices", () => {
        const { st, brA, brB } = bundleFixture();
        // move the last element of brA down - must be no-op (not cross into brB)
        ops.moveReplyInBranch(st, brA, brA.choiceIds.at(-1)!, 1);

        expect(brA.choiceIds.at(-1)).toBe("Node001#opt1");
        expect(brB.choiceIds[0]).toBe("Node001#opt2");
    });
});

// ---------------------------------------------------------------------------
// Branch structural ops: addBranch / addElse / removeBranch
// ---------------------------------------------------------------------------

describe("dialog-edit-ops (branch structural)", () => {
    /** Single-if bundle: Node001 with one `if` branch holding two choices. */
    function singleIfFixture(): { m: DialogModel; st: DialogState; brA: DialogBranch } {
        const c0: DialogChoice = {
            id: "Node001#opt0",
            text: "a0",
            target: { kind: "exit" },
            condition: "(EvalUGlobal==0)",
        };
        const c1: DialogChoice = {
            id: "Node001#opt1",
            text: "a1",
            target: { kind: "exit" },
            condition: "(EvalUGlobal==0)",
        };
        const brA: DialogBranch = {
            kind: "if",
            condition: "(EvalUGlobal==0)",
            replies: [],
            choiceIds: ["Node001#opt0", "Node001#opt1"],
            opaque: [],
            stmtRange: { start: 10, end: 100 },
            conditionRange: { start: 13, end: 30 },
        };
        const st: DialogState = {
            id: "Node001",
            text: "@1",
            choices: [c0, c1],
            branches: [brA],
        };
        const m: DialogModel = {
            format: "fallout-ssl",
            editable: true,
            roots: [{ id: "d", label: "d", kind: "dialog", states: [st] }],
        };
        return { m, st, brA };
    }

    /** Two-branch if/else bundle. */
    function ifElseFixture(): { m: DialogModel; st: DialogState; brA: DialogBranch; brB: DialogBranch } {
        const c0: DialogChoice = { id: "Node001#opt0", text: "a0", target: { kind: "exit" } };
        const c1: DialogChoice = { id: "Node001#opt1", text: "b0", target: { kind: "exit" } };
        const brA: DialogBranch = {
            kind: "if",
            condition: "(EvalUGlobal==0)",
            replies: [],
            choiceIds: ["Node001#opt0"],
            opaque: [],
            stmtRange: { start: 10, end: 100 },
        };
        const brB: DialogBranch = {
            kind: "else",
            replies: [],
            choiceIds: ["Node001#opt1"],
            opaque: [],
            elseClauseRange: { start: 50, end: 100 },
        };
        const st: DialogState = {
            id: "Node001",
            text: "@1",
            choices: [c0, c1],
            branches: [brA, brB],
        };
        const m: DialogModel = {
            format: "fallout-ssl",
            editable: true,
            roots: [{ id: "d", label: "d", kind: "dialog", states: [st] }],
        };
        return { m, st, brA, brB };
    }

    it("addBranch appends a pending-new if branch with the given condition", () => {
        const { st } = singleIfFixture();
        const before = st.branches!.length;
        const br = ops.addBranch(st, "(EvalUGlobal==1)");

        expect(st.branches!.length).toBe(before + 1);
        expect(st.branches!.at(-1)).toBe(br);
        expect(br.kind).toBe("if");
        expect(br.condition).toBe("(EvalUGlobal==1)");
        expect(br.choiceIds).toEqual([]);
        expect(br.replies).toEqual([]);
        expect(br.opaque).toEqual([]);
    });

    it("addBranch produces a pending-new branch: no span fields present", () => {
        const { st } = singleIfFixture();
        const br = ops.addBranch(st, "(EvalUGlobal==1)");

        expect(br.stmtRange).toBeUndefined();
        expect(br.elseClauseRange).toBeUndefined();
        expect(br.thenBlockEnd).toBeUndefined();
        expect(br.insertAnchor).toBeUndefined();
        expect(br.conditionRange).toBeUndefined();
    });

    it("addBranch initialises branches to [] if state.branches is undefined", () => {
        const st: DialogState = { id: "Node002", text: "@2", choices: [] };
        ops.addBranch(st, "(x==1)");
        expect(st.branches).toBeDefined();
        expect(st.branches!.length).toBe(1);
    });

    it("addElse appends a pending-new else branch on a single-if node", () => {
        const { st } = singleIfFixture();
        const br = ops.addElse(st);

        expect(br).not.toBeNull();
        expect(br!.kind).toBe("else");
        expect(br!.condition).toBeUndefined();
        expect(br!.choiceIds).toEqual([]);
        expect(br!.replies).toEqual([]);
        expect(br!.opaque).toEqual([]);
        expect(st.branches!.at(-1)).toBe(br);
    });

    it("addElse returns null and does not modify branches when node already has an else", () => {
        const { st } = ifElseFixture();
        const before = st.branches!.length;
        const result = ops.addElse(st);

        expect(result).toBeNull();
        expect(st.branches!.length).toBe(before);
    });

    it("addElse returns null when branches is undefined (no if branch)", () => {
        const st: DialogState = { id: "Node003", text: "@3", choices: [] };
        expect(ops.addElse(st)).toBeNull();
    });

    it("addElse returns null when there are multiple branches (not a single if)", () => {
        const { st } = singleIfFixture();
        // Add a second if branch without an else - more than one branch -> no else allowed
        ops.addBranch(st, "(EvalUGlobal==2)");
        const result = ops.addElse(st);
        expect(result).toBeNull();
    });

    it("addElse produces a pending-new branch: no span fields", () => {
        const { st } = singleIfFixture();
        const br = ops.addElse(st)!;

        expect(br.stmtRange).toBeUndefined();
        expect(br.elseClauseRange).toBeUndefined();
        expect(br.thenBlockEnd).toBeUndefined();
        expect(br.insertAnchor).toBeUndefined();
        expect(br.conditionRange).toBeUndefined();
    });

    it("removeBranch drops the branch from state.branches", () => {
        const { st } = ifElseFixture();
        const before = st.branches!.length;
        ops.removeBranch(st, 0);

        expect(st.branches!.length).toBe(before - 1);
        expect(st.branches!.every((b) => b.kind !== "if")).toBe(true);
    });

    it("removeBranch removes the branch's choiceIds from state.choices", () => {
        const { st } = ifElseFixture();
        // brA has Node001#opt0, brB has Node001#opt1
        ops.removeBranch(st, 0);

        expect(st.choices.find((c) => c.id === "Node001#opt0")).toBeUndefined();
        expect(st.choices.find((c) => c.id === "Node001#opt1")).toBeDefined();
    });

    it("removeBranch on the else branch removes its choices and leaves if branch intact", () => {
        const { st } = ifElseFixture();
        ops.removeBranch(st, 1);

        expect(st.branches!.length).toBe(1);
        expect(st.branches![0]!.kind).toBe("if");
        expect(st.choices.find((c) => c.id === "Node001#opt0")).toBeDefined();
        expect(st.choices.find((c) => c.id === "Node001#opt1")).toBeUndefined();
    });

    describe("applyReconcile", () => {
        function reconcileModel(): DialogModel {
            return {
                format: "fallout-ssl",
                editable: false,
                messages: { "100": "npc" },
                roots: [
                    {
                        id: "dialog",
                        label: "dialog",
                        kind: "dialog",
                        states: [
                            {
                                id: "Node001",
                                text: "@100",
                                choices: [{ id: "Node001#reply", text: "typed literal", target: { kind: "exit" } }],
                            },
                            { id: "Node050", text: "new node line", choices: [] },
                        ],
                    },
                ],
            };
        }

        it("stamps a committed option's @N text and merges its .msg entry", () => {
            const m = reconcileModel();
            ops.applyReconcile(m, { "Node001#reply": "@201" }, { "201": "typed literal" });
            const c = m.roots[0]!.states[0]!.choices[0]!;
            expect(c.text).toBe("@201");
            expect(c.committed).toBe(true);
            expect(m.messages).toEqual({ "100": "npc", "201": "typed literal" });
            // The untouched node stays pending (no committed flag).
            expect(m.roots[0]!.states[1]!.committed).toBeUndefined();
        });

        it("stamps a committed new node's reply @N and merges .msg", () => {
            const m = reconcileModel();
            ops.applyReconcile(m, { Node050: "@202" }, { "202": "new node line" });
            const s = m.roots[0]!.states[1]!;
            expect(s.text).toBe("@202");
            expect(s.committed).toBe(true);
            expect(m.messages?.["202"]).toBe("new node line");
        });

        it("is a no-op on empty allocations (still merges messages)", () => {
            const m = reconcileModel();
            ops.applyReconcile(m, {}, { "300": "extra" });
            expect(m.roots[0]!.states[0]!.choices[0]!.committed).toBeUndefined();
            expect(m.messages?.["300"]).toBe("extra");
        });
    });
});
