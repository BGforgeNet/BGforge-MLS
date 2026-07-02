import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";
import { modelFromSSL, type DialogModel } from "../../shared/dialog-model";
import { computeDialogSourceEdit } from "../../client/src/dialog-editor/dialog-source-edit";
import { applyReconcile } from "../../shared/dialog-edit-ops";

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
