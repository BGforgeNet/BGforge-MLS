import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";
import { modelFromSSL, type DialogModel } from "../../shared/dialog-model";
import { computeDialogSourceEdit } from "../../client/src/dialog-editor/dialog-source-edit";
import { addReply, addState, applyReconcile } from "../../shared/dialog-edit-ops";

// "Add an option, then keep editing it" must not duplicate the option.
//
// The webview holds a working copy (editModel) and emits it to the host on any mutation. The host splices
// the change into the .ssl and, because the echo guard suppresses the re-project that would give a freshly-
// added option its real source span (to keep selection/in-progress text), it instead posts a `reconcile`
// message carrying the allocated `@N` ids. The webview applies it via `applyReconcile`, marking the pending
// option `committed`.
//
// Without that reconcile a second emit is computed against a STALE model plus a re-parse of the now-changed
// source: the pending choice's id never matches the re-parsed option's id, so the splicer re-adds it - and
// a terminal NMessage (EXIT target, the addReply default) carries no callRange, so it is invisible to the
// remove/survivor logic and cannot be matched, duplicating the option on every keystroke-emit. This test
// pins the reconciled flow: the committed option stays a single, stable option across further edits.
describe("SSL add-option then keep-editing round-trip", () => {
    const SRC0 = `procedure Node001 begin\n    NOption(101, Node002, 4);\nend\nprocedure Node002 begin Reply(200); end\nprocedure talk_p_proc begin call Node001; end\n`;

    // The webview's addReply gesture: a pending choice with a `${state.id}#reply` id and no source span.
    function webviewModelWithPendingOption(base: DialogModel, replyText: string): DialogModel {
        const m = structuredClone(base);
        m.roots[0]!.states.find((s) => s.id === "Node001")!.choices.push({
            id: "Node001#reply",
            text: replyText,
            target: { kind: "exit" },
        });
        return m;
    }

    it("keeps one stable, committed option (no duplication) when the new option is edited after reconcile", async () => {
        const original0 = modelFromSSL(await parseDialog(SRC0));

        // EMIT 1: the user added an option and typed "Ask about the map".
        const editModel = webviewModelWithPendingOption(original0, "Ask about the map");
        const r1 = computeDialogSourceEdit(SRC0, editModel, original0);
        const src1 = r1.newText ?? SRC0;

        // Exactly one new terminal option was spliced, and the allocation is reported for the reconcile.
        expect((src1.match(/NMessage\(/g) ?? []).length).toBe(1);
        const id1 = Object.keys(r1.messages).find((k) => r1.messages[k] === "Ask about the map")!;
        expect(src1).toContain(`NMessage(${id1});`);
        expect(r1.allocations).toEqual({ "Node001#reply": `@${id1}` });

        // RECONCILE: what the webview does on the host's reconcile message - stamp the option committed IN
        // PLACE (the same working copy, so selection/positions survive), and merge the .msg text.
        applyReconcile(editModel, r1.allocations, r1.messages);
        const committed = editModel.roots[0]!.states.find((s) => s.id === "Node001")!.choices.find(
            (c) => c.id === "Node001#reply",
        )!;
        expect(committed.text).toBe(`@${id1}`);
        expect(committed.committed).toBe(true);
        expect(editModel.messages?.[id1]).toBe("Ask about the map");

        // EMIT 2: the user keeps typing - a bare `@N` message-text edit goes to the .msg, so editModel.messages
        // changes but the option is unchanged. The re-parse of emit 1's output is the current `original`.
        editModel.messages![id1] = "Ask about the map, please";
        const original1 = modelFromSSL(await parseDialog(src1));
        const r2 = computeDialogSourceEdit(src1, editModel, original1);

        // A committed option is NOT re-spliced: the source is unchanged (text-only edit -> no WorkspaceEdit),
        // so there is still exactly one new option and no duplicate.
        expect(r2.newText).toBeNull();
        expect((src1.match(/NMessage\(/g) ?? []).length).toBe(1);
        expect(r2.allocations).toEqual({});
    });
});

// "Add a state, then add more options to it" - the reported creation flow. A freshly-added SSL node is now
// structurally editable at once (isLocalNewSSLNode), so the user can add options before any save. This pins
// the full path: the new procedure is spliced once; a second option added after the reconcile lands in that
// same procedure without re-emitting (duplicating) it.
describe("SSL add-state then add-more-options round-trip", () => {
    const SRC0 = `procedure Node001 begin\n    NOption(101, Node002, 4);\nend\nprocedure Node002 begin Reply(200); end\nprocedure talk_p_proc begin call Node001; end\n`;

    it("splices the new node once, and a second option added after reconcile does not duplicate the procedure", async () => {
        const original0 = modelFromSSL(await parseDialog(SRC0));

        // EMIT 1: the user added a state (Node003), typed its NPC line and one option, and wired Node001's
        // option to it so it is reachable (else the re-parse prunes the unreachable procedure).
        const editModel = structuredClone(original0);
        const newState = addState(editModel)!;
        expect(newState.id).toBe("Node003"); // next free id
        newState.text = "A brand new line.";
        const opt1 = addReply(editModel, newState);
        opt1.text = "First option";
        editModel.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!.target = {
            kind: "state",
            stateId: newState.id,
        };

        const r1 = computeDialogSourceEdit(SRC0, editModel, original0);
        const src1 = r1.newText!;
        expect(src1).not.toBeNull();
        expect((src1.match(/procedure Node003\b/g) ?? []).length).toBe(1); // spliced exactly once
        expect(src1).toContain("NOption(101, Node003, 4)"); // inbound option retargeted to the new node
        // Both the node line and its option were allocated `@N` ids and reported for the reconcile.
        expect(r1.allocations[newState.id]).toMatch(/^@\d+$/);
        expect(r1.allocations[opt1.id]).toMatch(/^@\d+$/);

        // RECONCILE: the node and its option are stamped committed in place.
        applyReconcile(editModel, r1.allocations, r1.messages);
        expect(newState.committed).toBe(true);
        expect(opt1.committed).toBe(true);

        // EMIT 2: the user adds a SECOND option to the (committed, still procRange-less) new node.
        const opt2 = addReply(editModel, newState);
        opt2.text = "Second option";
        const original1 = modelFromSSL(await parseDialog(src1));
        const r2 = computeDialogSourceEdit(src1, editModel, original1);
        const src2 = r2.newText!;

        expect(src2).not.toBeNull();
        // The procedure is NOT re-emitted (committed) - it stays a single Node003, now carrying BOTH options.
        expect((src2.match(/procedure Node003\b/g) ?? []).length).toBe(1);
        expect((src2.match(/NMessage\(/g) ?? []).length).toBe(2); // first + second option, no duplicate
        expect(r2.allocations[opt2.id]).toMatch(/^@\d+$/); // only the second option is newly committed
        expect(r2.allocations[opt1.id]).toBeUndefined();
    });
});
