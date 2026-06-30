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
