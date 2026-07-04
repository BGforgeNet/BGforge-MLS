import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";
import { modelFromSSL, type DialogModel } from "../../shared/dialog-model";
import { computeDialogSourceEdit } from "../../client/src/dialog-editor/dialog-source-edit";
import { addReply, addState, applyReconcile, setChoiceTarget } from "../../shared/dialog-edit-ops";
import { applySSLDialogEdits } from "../../shared/dialog-ssl-edit";

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

// From-scratch bootstrap + scaffold: a blank SSL file (no talk_p_proc) parses to zero roots, so `+ State`
// mints the first root, and the save must scaffold the whole dialog skeleton - the ADD path has no anchor to
// splice a bare procedure into. This pins the real parse -> bootstrap -> allocate -> scaffold -> re-parse flow.
describe("SSL from-scratch dialog scaffold", () => {
    it("scaffolds talk_p_proc + Node998/Node999 + the entry node from a blank file, re-parseable", async () => {
        const original = modelFromSSL(await parseDialog(""));
        expect(original.roots).toHaveLength(0); // nothing to draw from scratch

        const editModel = structuredClone(original);
        const entry = addState(editModel); // bootstrap: mints the "dialog" root + first node
        expect(editModel.roots).toHaveLength(1);
        expect(entry.id).toBe("Node001");
        expect(entry.isEntry).toBe(true); // the router must call it
        entry.text = "Greetings, stranger.";
        // One option that leaves the conversation (targets the Node999 end node -> renders as Exit).
        const leave = addReply(editModel, entry);
        leave.text = "Goodbye.";
        setChoiceTarget(entry, leave.id, { kind: "state", stateId: "Node999" });

        const out = computeDialogSourceEdit("", editModel, original).newText!;
        expect(out).not.toBeNull();

        // Forward decls + a router calling the entry inside the standard gSay frame.
        expect(out).toContain("procedure talk_p_proc;");
        expect(out).toContain("procedure Node001;");
        expect(out).toContain("procedure Node998;");
        expect(out).toContain("procedure Node999;");
        expect(out).toContain("start_gdialog(NAME, self_obj, 4, -1, -1);");
        expect(out).toContain("call Node001;");
        // Support nodes carry their default bodies: Node998 sets hostile, Node999 is empty.
        expect(out).toContain("procedure Node998 begin");
        expect(out).toContain("set_hostile;");
        expect(out).toMatch(/procedure Node999 begin\nend/);

        // Re-parse: the entry node round-trips and talk_p_proc makes it a dialog entry.
        const reparsed = modelFromSSL(await parseDialog(out));
        const node1 = reparsed.roots.flatMap((rt) => rt.states).find((s) => s.id === "Node001");
        expect(node1).toBeDefined();
        expect(node1!.isEntry).toBe(true);
        expect(node1!.choices.some((c) => c.target.kind === "state" && c.target.stateId === "Node999")).toBe(true);
    });

    it("allocates a new node id that dodges an existing UNPROJECTED procedure (no duplicate on save)", async () => {
        // Node002 is an empty procedure: the model does not project it (no Reply/option, unreachable), but it is
        // a real name. A new node must skip past it to Node003, or the add/scaffold splice would emit a second
        // `procedure Node002`. Exercises the parser's procNames -> model.existingProcNames -> nextSslNodeId path.
        const SRC = "procedure Node001 begin\n    Reply(100);\nend\nprocedure Node002 begin\nend\n";
        const model = modelFromSSL(await parseDialog(SRC));
        // Sanity: Node001 projects (has a Reply); Node002 does not; but procNames carries both.
        expect(model.roots.flatMap((r) => r.states).map((s) => s.id)).toEqual(["Node001"]);
        expect(model.existingProcNames).toEqual(expect.arrayContaining(["Node001", "Node002"]));
        expect(addState(structuredClone(model)).id).toBe("Node003"); // not Node002 (unprojected but present)
    });

    it("emits Node998 with its combat body when an option is retargeted to Combat and the file lacks it", async () => {
        // Picking "Combat" sets an option's target to Node998. In a dialog that has talk_p_proc but no Node998,
        // the save must emit `procedure Node998` (with the combat body) or the `NOption(msg, Node998)` dangles.
        const SRC =
            "procedure Node001 begin\n    Reply(100);\n    NOption(101, Node002, 0);\nend\n" +
            "procedure Node002 begin\n    Reply(200);\nend\n" +
            "procedure talk_p_proc begin call Node001; end\n";
        const original = modelFromSSL(await parseDialog(SRC));
        const edited = structuredClone(original);
        // Retarget Node001's option (a node-targeting NOption -> supported survivor rewrite) to Combat (Node998).
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        const opt = n1.choices.find((c) => c.target.kind === "state" && c.target.stateId === "Node002")!;
        setChoiceTarget(n1, opt.id, { kind: "state", stateId: "Node998" });

        const out = applySSLDialogEdits(SRC, edited, original);
        expect(out).toContain("NOption(101, Node998, 0)"); // the option now points at Node998
        expect(out).toContain("procedure Node998 begin"); // and the support node was created
        expect(out).toContain("set_hostile;"); // with its combat body
        expect((out.match(/procedure Node998 begin/g) ?? []).length).toBe(1); // exactly once
        // Re-parses cleanly and Node001's option targets Node998.
        const reparsed = modelFromSSL(await parseDialog(out));
        const again = reparsed.roots.flatMap((r) => r.states).find((s) => s.id === "Node001")!;
        expect(again.choices.some((c) => c.target.kind === "state" && c.target.stateId === "Node998")).toBe(true);
    });

    it("retargets a terminal (exit) option to a node: NMessage becomes NOption", async () => {
        // A new option defaults to EXIT -> NMessage(id) (no target). Retargeting it to a node (e.g. Combat, or
        // any state) must rewrite the whole statement into NOption(id, Node, skill) - the in-place survivor
        // rewrite only edits an existing call's target token and can't add one, so this was previously a no-op.
        const SRC =
            "procedure Node001 begin\n    Reply(100);\n    NMessage(101);\nend\n" +
            "procedure Node002 begin\n    Reply(200);\nend\n" +
            "procedure talk_p_proc begin call Node001; end\n";
        const original = modelFromSSL(await parseDialog(SRC));
        const edited = structuredClone(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        const term = n1.choices.find((c) => c.target.kind === "exit")!;
        setChoiceTarget(n1, term.id, { kind: "state", stateId: "Node002" });

        const out = applySSLDialogEdits(SRC, edited, original);
        expect(out).toContain("NOption(101, Node002, 0)"); // NMessage rewritten to a node-targeting NOption
        expect(out).not.toContain("NMessage(101)"); // the old terminal is gone
        const reparsed = modelFromSSL(await parseDialog(out));
        const again = reparsed.roots.flatMap((r) => r.states).find((s) => s.id === "Node001")!;
        expect(again.choices.some((c) => c.target.kind === "state" && c.target.stateId === "Node002")).toBe(true);
    });

    it("retargets a node option to exit: NOption becomes NMessage (reverse flip)", async () => {
        const SRC =
            "procedure Node001 begin\n    Reply(100);\n    NOption(101, Node002, 4);\nend\n" +
            "procedure Node002 begin\n    Reply(200);\nend\n" +
            "procedure talk_p_proc begin call Node001; end\n";
        const original = modelFromSSL(await parseDialog(SRC));
        const edited = structuredClone(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        const opt = n1.choices.find((c) => c.target.kind === "state" && c.target.stateId === "Node002")!;
        setChoiceTarget(n1, opt.id, { kind: "exit" });

        const out = applySSLDialogEdits(SRC, edited, original);
        expect(out).toContain("NMessage(101)"); // node option rewritten to a terminal message
        expect(out).not.toContain("NOption(101"); // the old node call is gone
        const reparsed = modelFromSSL(await parseDialog(out));
        const again = reparsed.roots.flatMap((r) => r.states).find((s) => s.id === "Node001")!;
        expect(again.choices.some((c) => c.id === opt.id && c.target.kind === "exit")).toBe(true);
    });

    it("scaffold then edit the entry node: procedure is NOT duplicated, and the reply lands", async () => {
        // The reconcile-gap regression: a from-scratch scaffold emits an EMPTY entry node (no @N yet), so the
        // reconcile never marked it committed and every SUBSEQUENT edit re-emitted the whole procedure ->
        // duplicate `procedure Node001` blocks (a corrupt, uncompilable .ssl). Pins the full flow: scaffold ->
        // reconcile -> type an NPC line -> re-save, exactly one procedure, and the reply is spliced in.
        const original0 = modelFromSSL(await parseDialog(""));
        const editModel = structuredClone(original0);
        const entry = editModel.roots.length > 0 ? undefined : addState(editModel); // bootstrap Node001 (empty)
        expect(entry?.id).toBe("Node001");

        // Save 1: scaffold.
        const r1 = computeDialogSourceEdit("", editModel, original0);
        const src1 = r1.newText!;
        expect((src1.match(/procedure Node001 begin/g) ?? []).length).toBe(1);
        applyReconcile(editModel, r1.allocations, r1.messages);

        // Save 2: the user typed the NPC line on the (now source-present) entry node.
        entry!.text = "Greetings, wanderer.";
        const original1 = modelFromSSL(await parseDialog(src1));
        const r2 = computeDialogSourceEdit(src1, editModel, original1);
        const src2 = r2.newText ?? src1;

        expect((src2.match(/procedure Node001 begin/g) ?? []).length).toBe(1); // NOT duplicated
        const reparsed = modelFromSSL(await parseDialog(src2));
        const n1 = reparsed.roots.flatMap((r) => r.states).find((s) => s.id === "Node001")!;
        expect(n1.text).toMatch(/^@\d+$/); // the reply (NPC line) was spliced into the one procedure
    });

    it("does not re-emit a support node the file already declares", async () => {
        // A script that already defines Node999 (but no talk_p_proc) keeps its Node999 byte-for-byte - the
        // scaffold emits only the MISSING support nodes (here, Node998).
        const SRC = "procedure Node999 begin\n    // custom end\nend\n";
        const original = modelFromSSL(await parseDialog(SRC));
        const editModel = structuredClone(original);
        const entry = addState(editModel);
        entry.text = "Hi.";
        const out = computeDialogSourceEdit(SRC, editModel, original).newText!;
        expect((out.match(/procedure Node999 begin/g) ?? []).length).toBe(1); // not re-emitted
        expect(out).toContain("// custom end"); // existing body preserved
        expect(out).toContain("procedure Node998 begin"); // the missing one is still scaffolded
    });
});
