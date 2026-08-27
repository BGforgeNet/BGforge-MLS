import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";
import { modelFromSSL, type DialogModel } from "../../shared/dialog-model";
import { computeDialogSourceEdit } from "../../client/src/dialog-editor/dialog-source-edit";
import { addReply, addState, setChoiceTarget } from "../../shared/dialog-edit-ops";
import { applySSLDialogEdits } from "../../shared/dialog-ssl-edit";

// "Add an option, then keep editing it" must not duplicate the option.
//
// The webview holds a working copy (editModel) and emits it to the host on any mutation. The host splices
// the change into the .ssl and posts the faithful re-parse back, which the webview ADOPTS wholesale (an open
// inline edit survives via the draft overlay - see DialogGraph's adoptModel). The next emit is therefore
// computed from the adopted parse, where the just-added option carries its real source span - so the splicer
// treats it as existing and never re-adds it. These tests emulate that adopt step the way production runs it:
// re-parse the spliced source and merge the posted messages.
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

    /** The webview's adopt step: the faithful parse of the spliced source, with the posted messages merged. */
    async function adopt(src: string, messages: Record<string, string>): Promise<DialogModel> {
        const adopted = modelFromSSL(await parseDialog(src));
        adopted.messages = { ...adopted.messages, ...messages };
        return adopted;
    }

    it("keeps one stable option (no duplication) when the new option is edited after the adopt", async () => {
        const original0 = modelFromSSL(await parseDialog(SRC0));

        // EMIT 1: the user added an option and typed "Ask about the map".
        const editModel = webviewModelWithPendingOption(original0, "Ask about the map");
        const r1 = computeDialogSourceEdit(SRC0, editModel, original0);
        const src1 = r1.newText ?? SRC0;

        // Exactly one new terminal option was spliced, and the allocation is reported for the selection remap.
        expect((src1.match(/NMessage\(/g) ?? []).length).toBe(1);
        const id1 = Object.keys(r1.messages).find((k) => r1.messages[k] === "Ask about the map")!;
        expect(src1).toContain(`NMessage(${id1});`);
        expect(r1.allocations).toEqual({ "Node001#reply": `@${id1}` });

        // ADOPT: the webview replaces its working copy with the re-parse; the option now has a real span.
        const adopted = await adopt(src1, r1.messages);
        const option = adopted.roots[0]!.states.find((s) => s.id === "Node001")!.choices.find(
            (c) => c.text === `@${id1}`,
        )!;
        expect(option.stmtRange).toBeDefined(); // existing in source, no longer pending
        expect(adopted.messages?.[id1]).toBe("Ask about the map");

        // EMIT 2: the user keeps typing - a bare `@N` message-text edit goes to the .msg, so messages change
        // but the option is unchanged. The re-parse of emit 1's output is the current `original`.
        adopted.messages![id1] = "Ask about the map, please";
        const original1 = modelFromSSL(await parseDialog(src1));
        const r2 = computeDialogSourceEdit(src1, adopted, original1);

        // An adopted option is NOT re-spliced: the source is unchanged (text-only edit -> no WorkspaceEdit),
        // so there is still exactly one new option and no duplicate.
        expect(r2.newText).toBeNull();
        expect((src1.match(/NMessage\(/g) ?? []).length).toBe(1);
        expect(r2.allocations).toEqual({});
    });

    // "Add a state, then add more options to it" - the reported creation flow. A freshly-added SSL node is
    // structurally editable at once (isLocalNewSSLNode), so the user can add options before any save. This pins
    // the full path: the new procedure is spliced once; a second option added after the adopt lands in that
    // same procedure without re-emitting (duplicating) it.
    it("splices the new node once, and a second option added after the adopt does not duplicate it", async () => {
        const original0 = modelFromSSL(await parseDialog(SRC0));

        // EMIT 1: the user added a state (Node003), typed its NPC line and one option, and wired Node001's
        // option to it so it is reachable (else the re-parse prunes the unreachable procedure).
        const editModel = structuredClone(original0);
        const newState = addState(editModel);
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
        // Both the node line and its option were allocated `@N` ids and reported for the selection remap.
        expect(r1.allocations[newState.id]).toMatch(/^@\d+$/);
        expect(r1.allocations[opt1.id]).toMatch(/^@\d+$/);

        // ADOPT, then EMIT 2: the user adds a SECOND option to the (now source-present) new node.
        const adopted = await adopt(src1, r1.messages);
        const node3 = adopted.roots[0]!.states.find((s) => s.id === "Node003")!;
        expect(node3.procRange).toBeDefined(); // adopted with its real span
        const opt2 = addReply(adopted, node3);
        opt2.text = "Second option";
        const original1 = modelFromSSL(await parseDialog(src1));
        const r2 = computeDialogSourceEdit(src1, adopted, original1);
        const src2 = r2.newText!;

        expect(src2).not.toBeNull();
        // The procedure is NOT re-emitted - it stays a single Node003, now carrying BOTH options.
        expect((src2.match(/procedure Node003\b/g) ?? []).length).toBe(1);
        expect((src2.match(/NMessage\(/g) ?? []).length).toBe(2); // first + second option, no duplicate
        expect(r2.allocations[opt2.id]).toMatch(/^@\d+$/); // only the second option is newly spliced
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

    it("allocates a new node id that dodges an existing empty NodeNNN (no duplicate on save)", async () => {
        // Node002 is an empty procedure. It now PROJECTS as a dialog node in progress (BUG A: an empty NodeNNN
        // is a real node, not an invisible disk orphan), and it is also a real name a new node must skip past to
        // Node003 - or the add/scaffold splice would emit a second `procedure Node002`. Exercises the parser's
        // procNames -> model.existingProcNames -> nextSslNodeId path plus the empty-node projection.
        const SRC = "procedure Node001 begin\n    Reply(100);\nend\nprocedure Node002 begin\nend\n";
        const model = modelFromSSL(await parseDialog(SRC));
        // Both Node001 (has a Reply) and the empty Node002 project; procNames carries both too.
        expect(model.roots.flatMap((r) => r.states).map((s) => s.id)).toEqual(["Node001", "Node002"]);
        expect(model.existingProcNames).toEqual(expect.arrayContaining(["Node001", "Node002"]));
        expect(addState(structuredClone(model)).id).toBe("Node003"); // not Node002 (already present)
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
        // A from-scratch scaffold emits an EMPTY entry node (no @N yet). The webview then adopts the re-parse,
        // so the node the user keeps editing is the SOURCE-PRESENT one (real procRange) - re-emitting it as new
        // is impossible by construction. Pins the full flow: scaffold -> adopt -> type an NPC line -> re-save,
        // exactly one procedure, and the reply is spliced in.
        const original0 = modelFromSSL(await parseDialog(""));
        const editModel = structuredClone(original0);
        const entry = editModel.roots.length > 0 ? undefined : addState(editModel); // bootstrap Node001 (empty)
        expect(entry?.id).toBe("Node001");

        // Save 1: scaffold.
        const r1 = computeDialogSourceEdit("", editModel, original0);
        const src1 = r1.newText!;
        expect((src1.match(/procedure Node001 begin/g) ?? []).length).toBe(1);

        // ADOPT: the entry node comes back source-present (procRange set), and stays in the model even
        // though its body is still empty - the router's call keeps it projected.
        const adopted = modelFromSSL(await parseDialog(src1));
        adopted.messages = { ...adopted.messages, ...r1.messages };
        const adoptedEntry = adopted.roots.flatMap((r) => r.states).find((s) => s.id === "Node001")!;
        expect(adoptedEntry).toBeDefined();
        expect(adoptedEntry.procRange).toBeDefined();

        // Save 2: the user typed the NPC line on the adopted entry node.
        adoptedEntry.text = "Greetings, wanderer.";
        const original1 = modelFromSSL(await parseDialog(src1));
        const r2 = computeDialogSourceEdit(src1, adopted, original1);
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

// A new node's procedure must be spliced onto its OWN line - never concatenated onto the preceding procedure's
// `end` as `endprocedure <name>`, which lexes as a single identifier and drops the node on re-parse (observed
// live: rename a node + save, then add a node + save -> `endprocedure FreshGreeting`, and the node vanishes).
// The add-splice inserts at `newProcAnchor`; the webview model's byte offsets are not re-projected between
// saves, so a length-changing prior edit can leave a STALE anchor whose preceding byte is a non-newline.
describe("SSL add-node splice keeps a separating newline", () => {
    const SRC = `procedure Node001 begin\n    Reply(200);\n    NOption(201, Node999, 4);\nend\nprocedure talk_p_proc begin\n    call Node001;\nend\n`;

    it("prepends a newline when a stale anchor abuts a preceding `end` (no `endprocedure`)", async () => {
        const original = modelFromSSL(await parseDialog(SRC));
        const editModel = structuredClone(original);
        // Simulate a stale/abutting anchor: point newProcAnchor just past Node001's `end` (a non-newline byte),
        // as a length-changing prior edit in the same webview session would leave it.
        const abut = SRC.indexOf("end") + 3;
        expect(SRC[abut - 1]).toBe("d"); // precondition: the anchor abuts a non-newline
        editModel.newProcAnchor = abut;
        const fresh = addState(editModel, editModel.roots[0], "NewNode");
        fresh.text = "A new line."; // computeDialogSourceEdit allocates its @id, so the node has real content
        addReply(editModel, fresh).text = "Bye";

        // The real webview->host entry (allocates @ids, then splices). Support node Node999 (referenced but
        // undefined) is ALSO scaffolded at the same anchor - both splices must keep the separating newline.
        const out = computeDialogSourceEdit(SRC, editModel, original).newText!;
        expect(out).not.toContain("endprocedure"); // never `end` glued to `procedure`
        expect(out).toMatch(/\nprocedure NewNode\b/); // spliced on its own line
        expect(out).toMatch(/\nprocedure Node999\b/); // the scaffolded support node too
        // The file still tokenizes: NewNode is a real, re-parseable procedure (not swallowed into `endprocedure`).
        const reparsed = await parseDialog(out);
        expect(reparsed.nodes.map((n) => n.name)).toContain("NewNode");
    });
});
