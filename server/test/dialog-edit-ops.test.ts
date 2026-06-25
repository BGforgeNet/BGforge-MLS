import { beforeAll, describe, expect, it } from "vitest";
import { initParser } from "../../shared/parsers/weidu-d";
import { parseDDialog } from "../src/weidu-d/dialog";
import { modelFromD } from "../../shared/dialog-model";
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
