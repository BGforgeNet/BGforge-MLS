import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";
import { modelFromSSL, type DialogModel } from "../../shared/dialog-model";
import { applySSLDialogEdits, eligibleToDelete, verifySSLEditApplied } from "../../shared/dialog-ssl-edit";
import { duplicateState } from "../../shared/dialog-edit-ops";
import { allocateNodeIds } from "../../shared/dialog-ssl-ids";
import { serializeCond, serializeSSLConditionalOption } from "../../shared/dialog-ssl-serialize";

const structuredCloneModel = (m: DialogModel): DialogModel => structuredClone(m);

const SRC = `procedure Node001 begin
    NOption(101, Node002, 4);
    NOption(102, Node003, 4);
end
procedure Node002 begin Reply(200); end
procedure Node003 begin Reply(300); end
procedure talk_p_proc begin call Node001; end
`;

describe("applySSLDialogEdits", () => {
    it("retargets an option by replacing only its target-arg span", async () => {
        const original = modelFromSSL(await parseDialog(SRC));
        const edited = structuredCloneModel(original);
        const opt = edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!;
        opt.target = { kind: "state", stateId: "Node003" };
        const out = applySSLDialogEdits(SRC, edited, original);
        expect(out).toContain("NOption(101, Node003, 4)");
        expect(out).toContain("NOption(102, Node003, 4)"); // the other option untouched
    });

    it("reorders options by swapping their call spans, leaving the rest byte-for-byte", async () => {
        const original = modelFromSSL(await parseDialog(SRC));
        const edited = structuredCloneModel(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        n1.choices.reverse();
        const out = applySSLDialogEdits(SRC, edited, original);
        const i102 = out.indexOf("NOption(102");
        const i101 = out.indexOf("NOption(101");
        expect(i102).toBeGreaterThan(-1);
        expect(i102).toBeLessThan(i101); // 102 now precedes 101
        // Untouched bytes survive: the two terminal procedures are byte-for-byte.
        expect(out).toContain("procedure Node002 begin Reply(200); end");
        expect(out).toContain("procedure Node003 begin Reply(300); end");
    });

    it("refuses a structural edit to a non-faithful node (returns the source unchanged)", async () => {
        const src2 = `procedure Node001 begin
    if (global_var(GVAR_X) == 1) then NOption(101, Node002, 4) else NOption(102, Node003, 4);
end
procedure Node002 begin Reply(200); end
procedure Node003 begin Reply(300); end
procedure talk_p_proc begin call Node001; end
`;
        const original = modelFromSSL(await parseDialog(src2));
        const edited = structuredCloneModel(original);
        edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!.target = {
            kind: "state",
            stateId: "Node003",
        };
        // Node001 has an else -> non-faithful -> the structural edit is ignored.
        expect(applySSLDialogEdits(src2, edited, original)).toBe(src2);
    });
});

describe("applySSLDialogEdits - add / remove", () => {
    const SRC2 = `procedure Node001 begin
    NOption(101, Node002, 4);
    NOption(102, Node003, 4);
end
procedure Node002 begin Reply(200); end
procedure Node003 begin Reply(300); end
procedure talk_p_proc begin call Node001; end
`;

    it("removes an option by splicing its whole statement out", async () => {
        const original = modelFromSSL(await parseDialog(SRC2));
        const edited = structuredCloneModel(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        n1.choices = n1.choices.filter((c) => c.id !== "Node001#opt0"); // drop the first option
        const out = applySSLDialogEdits(SRC2, edited, original);
        expect(out).not.toContain("NOption(101");
        // The survivor is intact and no stray blank line is left where the option was.
        expect(out).toContain("procedure Node001 begin\n    NOption(102, Node003, 4);\nend");
    });

    it("adds a new option by serializing it at the node's insert anchor", async () => {
        const original = modelFromSSL(await parseDialog(SRC2));
        const edited = structuredCloneModel(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        // A new option carries an allocated @id (Task 4 ran), a target, and NO callRange.
        n1.choices.push({
            id: "Node001#new0",
            text: "@500",
            target: { kind: "state", stateId: "Node002" },
            skill: 4,
        });
        const out = applySSLDialogEdits(SRC2, edited, original);
        expect(out).toContain("NOption(500, Node002, 4);");
        // It is inserted after the existing options, before `end`.
        expect(out.indexOf("NOption(500")).toBeGreaterThan(out.indexOf("NOption(102"));
        expect(out.indexOf("NOption(500")).toBeLessThan(out.indexOf("\nend"));
    });

    it("removes the last option and adds one in the same save without overlap", async () => {
        const original = modelFromSSL(await parseDialog(SRC2));
        const edited = structuredCloneModel(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        // Drop opt1 (the LAST option, whose statement ends at the node insert anchor) and add a new one.
        n1.choices = n1.choices.filter((c) => c.id !== "Node001#opt1");
        n1.choices.push({ id: "Node001#new0", text: "@500", target: { kind: "state", stateId: "Node002" } });
        const out = applySSLDialogEdits(SRC2, edited, original);
        expect(out).not.toContain("NOption(102"); // removed
        // No overlap corruption: Node001 reads cleanly with opt0 + the new option.
        expect(out).toContain(
            "procedure Node001 begin\n    NOption(101, Node002, 4);\n    NOption(500, Node002);\nend",
        );
        expect(out).toContain("NOption(101, Node002, 4)"); // survivor intact
        expect(out).toContain("NOption(500, Node002);"); // added, well-formed (no overlap corruption)
        // The whole talk_p_proc / other procedures are still intact (no byte mangling from an overlap).
        expect(out).toContain("procedure talk_p_proc begin call Node001; end");
    });
});

describe("applySSLDialogEdits - delete node", () => {
    const SRC3 = `procedure Node001 begin
    NOption(101, Node002, 4);
    NOption(102, Node003, 4);
end
procedure Node002 begin Reply(200); end
procedure Node003 begin Reply(300); end
procedure talk_p_proc begin call Node001; end
`;

    it("deletes a node's procedure and redirects an inbound option to NMessage", async () => {
        const original = modelFromSSL(await parseDialog(SRC3));
        const edited = structuredCloneModel(original);
        // Mirror ops.deleteState: drop Node002's state and redirect inbound options to exit.
        const root = edited.roots[0]!;
        root.states = root.states.filter((s) => s.id !== "Node002");
        for (const s of root.states)
            for (const c of s.choices) {
                if (c.target.kind === "state" && c.target.stateId === "Node002") c.target = { kind: "exit" };
            }
        const out = applySSLDialogEdits(SRC3, edited, original);
        expect(out).not.toContain("procedure Node002"); // procedure gone
        // The option that pointed at Node002 is now a terminal message, keeping its msg id 101.
        expect(out).toContain("NMessage(101);");
        expect(out).not.toContain("NOption(101");
        // The other option is untouched.
        expect(out).toContain("NOption(102, Node003, 4)");
    });
});

describe("applySSLDialogEdits - add node", () => {
    const SRC4 = `procedure Node001 begin\n    NOption(101, Node002, 4);\nend\nprocedure Node002 begin Reply(200); end\nprocedure talk_p_proc begin call Node001; end\n`;

    it("splices a new node's procedure in before talk_p_proc", async () => {
        const original = modelFromSSL(await parseDialog(SRC4));
        const edited = structuredCloneModel(original);
        // A new node (no procRange) with an allocated reply id and one option, plus the inbound option retargeted.
        edited.roots[0]!.states.push({
            id: "Node050",
            text: "@500",
            choices: [{ id: "Node050#opt0", text: "@501", target: { kind: "exit" } }],
        });
        // Retarget Node001's option to the new node (Tier 1 machinery writes the name).
        edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!.target = {
            kind: "state",
            stateId: "Node050",
        };
        const out = applySSLDialogEdits(SRC4, edited, original);
        expect(out).toContain("procedure Node050 begin\n    Reply(500);\n    NMessage(501);\nend");
        expect(out).toContain("NOption(101, Node050, 4)"); // inbound option now names the new node
        expect(out.indexOf("procedure Node050")).toBeLessThan(out.indexOf("procedure talk_p_proc"));
    });
});

describe("eligibleToDelete", () => {
    it("allows deleting a node referenced only by options, or by a top-level call/entry in a faithful node", async () => {
        const src = `procedure Node001 begin\n    NOption(101, Node002, 4);\n    call Node003;\nend\nprocedure Node002 begin Reply(200); end\nprocedure Node003 begin Reply(300); end\nprocedure talk_p_proc begin call Node001; end\n`;
        const model = modelFromSSL(await parseDialog(src));
        expect(eligibleToDelete(model, "Node002")).toBe(true); // only an option points at it
        expect(eligibleToDelete(model, "Node003")).toBe(true); // reached by a top-level `call` in faithful Node001 - writer removes it
        expect(eligibleToDelete(model, "Node001")).toBe(true); // top-level entry in talk_p_proc - writer removes it
    });

    it("refuses a node whose inbound option lives in a non-faithful node (its reference cannot be rewritten)", async () => {
        // Node001 has a while loop -> non-faithful, so its NOption(101, Node002) is never rewritten by the
        // splicer. Deleting Node002 would leave a dangling reference, so delete must be refused.
        const src = `procedure Node001 begin\n    while (local_var(0)) do begin end\n    NOption(101, Node002, 4);\nend\nprocedure Node002 begin Reply(200); end\nprocedure talk_p_proc begin call Node001; end\n`;
        const model = modelFromSSL(await parseDialog(src));
        expect(model.roots[0]!.states.find((s) => s.id === "Node001")!.faithful).toBe(false);
        expect(eligibleToDelete(model, "Node002")).toBe(false);
    });

    it("refuses a force_dialog_start entry (in entryIds but no removable talk_p_proc call)", async () => {
        // NodeX is an entry via force_dialog_start (a non-dialog handler), so it is in entryIds but has no
        // entryCalls span the writer could remove - deleting its procedure would dangle the force_dialog_start.
        const src = `procedure NodeX begin Reply(100); end\nprocedure map_enter_p_proc begin force_dialog_start(NodeX); end\nprocedure talk_p_proc begin end\n`;
        const model = modelFromSSL(await parseDialog(src));
        expect(model.entryIds).toContain("NodeX");
        expect((model.entryCalls ?? []).some((ec) => ec.name === "NodeX")).toBe(false);
        expect(eligibleToDelete(model, "NodeX")).toBe(false);
    });
});

describe("verifySSLEditApplied", () => {
    it("confirms a correctly-applied retarget and rejects a save that did not take", async () => {
        const original = modelFromSSL(await parseDialog(SRC));
        const edited = structuredCloneModel(original);
        edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!.target = {
            kind: "state",
            stateId: "Node003",
        };
        const out = applySSLDialogEdits(SRC, edited, original);
        const actual = modelFromSSL(await parseDialog(out));
        expect(verifySSLEditApplied(edited, actual)).toEqual({ ok: true });

        // A save that silently did NOT take: the re-parse still matches the unedited source,
        // whose first option targets Node002, not the intended Node003.
        const stale = modelFromSSL(await parseDialog(SRC));
        const verdict = verifySSLEditApplied(edited, stale);
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain("Node001");
    });

    const SRC_AD = `procedure Node001 begin\n    NOption(101, Node002, 4);\nend\nprocedure Node002 begin Reply(200); end\nprocedure talk_p_proc begin call Node001; end\n`;

    it("verifies a node-add round-trip", async () => {
        const original = modelFromSSL(await parseDialog(SRC_AD));
        const edited = structuredCloneModel(original);
        edited.roots[0]!.states.push({
            id: "Node050",
            text: "@500",
            choices: [{ id: "Node050#opt0", text: "@501", target: { kind: "exit" } }],
        });
        edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!.target = {
            kind: "state",
            stateId: "Node050",
        };
        const out = applySSLDialogEdits(SRC_AD, edited, original);
        const actual = modelFromSSL(await parseDialog(out));
        expect(verifySSLEditApplied(edited, actual).ok).toBe(true);
    });

    it("verifies a node-delete round-trip (inbound option becomes a terminal)", async () => {
        const original = modelFromSSL(await parseDialog(SRC_AD));
        const edited = structuredCloneModel(original);
        const root = edited.roots[0]!;
        root.states = root.states.filter((s) => s.id !== "Node002");
        for (const s of root.states)
            for (const c of s.choices) {
                if (c.target.kind === "state" && c.target.stateId === "Node002") c.target = { kind: "exit" };
            }
        const out = applySSLDialogEdits(SRC_AD, edited, original);
        const actual = modelFromSSL(await parseDialog(out));
        expect(verifySSLEditApplied(edited, actual).ok).toBe(true);
    });
});

describe("applySSLDialogEdits - entry wiring", () => {
    const SRC_EW = `procedure Node001 begin\n    Reply(100);\nend\nprocedure talk_p_proc begin\n    call Node001;\nend\n`;

    it("adds a call into talk_p_proc when a node becomes an entry", async () => {
        const original = modelFromSSL(await parseDialog(SRC_EW));
        const edited = structuredCloneModel(original);
        // A new target-less node, marked as an entry.
        edited.roots[0]!.states.push({ id: "Node050", text: "@500", isEntry: true, choices: [] });
        const out = applySSLDialogEdits(SRC_EW, edited, original);
        // Its procedure is spliced (Tier 3a add path) AND a call is added to talk_p_proc.
        expect(out).toContain("procedure Node050 begin\n    Reply(500);\nend");
        // Tight: the new call lands inside talk_p_proc's body, after the existing entry call (a loose
        // wildcard would also pass if it landed in the wrong procedure).
        expect(out).toContain("procedure talk_p_proc begin\n    call Node001;\n    call Node050;\nend");
    });

    it("removes a node's call from talk_p_proc when it ceases to be an entry", async () => {
        const original = modelFromSSL(await parseDialog(SRC_EW));
        const edited = structuredCloneModel(original);
        edited.roots[0]!.states.find((s) => s.id === "Node001")!.isEntry = false;
        const out = applySSLDialogEdits(SRC_EW, edited, original);
        expect(out).not.toContain("call Node001;");
    });
});

describe("applySSLDialogEdits - delete a call-referenced / entry node", () => {
    const SRC_DC = `procedure Node001 begin\n    call Node002;\nend\nprocedure Node002 begin Reply(200); end\nprocedure talk_p_proc begin\n    call Node001;\nend\n`;

    it("deletes a call-referenced node, removing its inbound call", async () => {
        const original = modelFromSSL(await parseDialog(SRC_DC));
        const edited = structuredCloneModel(original);
        edited.roots[0]!.states = edited.roots[0]!.states.filter((s) => s.id !== "Node002");
        const out = applySSLDialogEdits(SRC_DC, edited, original);
        expect(out).not.toContain("procedure Node002");
        expect(out).not.toContain("call Node002;"); // inbound call removed, not dangling
    });

    it("eligibleToDelete now allows an entry / call-referenced node (faithful inbound)", async () => {
        const model = modelFromSSL(await parseDialog(SRC_DC));
        expect(eligibleToDelete(model, "Node001")).toBe(true); // entry, but cleanly removable now
        expect(eligibleToDelete(model, "Node002")).toBe(true); // reached by call in faithful Node001
    });
});

describe("applySSLDialogEdits - rename node", () => {
    const SRC_RN = `procedure Node001 begin\n    NOption(101, Node002, 4);\nend\nprocedure Node002 begin\n    call Node001;\nend\nprocedure talk_p_proc begin\n    call Node001;\nend\n`;

    it("renames a node's procedure and every reference (option target, call, entry call)", async () => {
        const original = modelFromSSL(await parseDialog(SRC_RN));
        const edited = structuredCloneModel(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        n1.renamedFrom = "Node001"; // what ops.renameState records
        n1.id = "Node009";
        // References on the model move with the rename (ops.renameState retargets them); mirror that here.
        for (const s of edited.roots[0]!.states)
            for (const c of s.choices)
                if (c.target.kind === "state" && c.target.stateId === "Node001")
                    c.target = { kind: "state", stateId: "Node009" };
        const out = applySSLDialogEdits(SRC_RN, edited, original);
        expect(out).toContain("procedure Node009 begin");
        expect(out).not.toContain("procedure Node001 begin");
        expect(out).toContain("NOption(101, Node002, 4)"); // unrelated option intact
        expect(out).not.toContain("call Node001;"); // both calls (Node002 + talk_p_proc) renamed
        expect((out.match(/call Node009;/g) ?? []).length).toBe(2);
    });

    it("renames a node referenced by a faithful node's option without double-splicing", async () => {
        const src = `procedure Node001 begin\n    NOption(101, Node002, 4);\nend\nprocedure Node002 begin Reply(200); end\nprocedure talk_p_proc begin call Node001; end\n`;
        const original = modelFromSSL(await parseDialog(src));
        const edited = structuredCloneModel(original);
        const n2 = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        n2.renamedFrom = "Node002";
        n2.id = "Node008";
        for (const s of edited.roots[0]!.states)
            for (const c of s.choices)
                if (c.target.kind === "state" && c.target.stateId === "Node002")
                    c.target = { kind: "state", stateId: "Node008" };
        const out = applySSLDialogEdits(src, edited, original);
        expect(out).toContain("procedure Node008 begin");
        expect(out).toContain("NOption(101, Node008, 4);"); // inbound option retargeted exactly once (no corruption)
        expect(out).not.toContain("Node002"); // no stale ref or doubled token
    });

    it("renames the node's forward declaration, not just its definition", async () => {
        // Real SSL forward-declares every procedure at the top. A rename must rewrite the forward
        // decl too, or the file is left with an orphan decl for the old name and the new proc undeclared.
        const src = `procedure Node001;\nprocedure Node002;\n\nprocedure Node001 begin\n    NOption(101, Node002, 4);\nend\nprocedure Node002 begin\n    Reply(200);\nend\nprocedure talk_p_proc begin\n    call Node001;\nend\n`;
        const original = modelFromSSL(await parseDialog(src));
        const edited = structuredCloneModel(original);
        const n2 = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        n2.renamedFrom = "Node002";
        n2.id = "Node777";
        for (const s of edited.roots[0]!.states)
            for (const c of s.choices)
                if (c.target.kind === "state" && c.target.stateId === "Node002")
                    c.target = { kind: "state", stateId: "Node777" };
        const out = applySSLDialogEdits(src, edited, original);
        expect(out).toContain("procedure Node777;"); // forward declaration renamed
        expect(out).toContain("procedure Node777 begin"); // definition renamed
        expect(out).not.toContain("Node002"); // no stale forward decl, target, or definition
    });
});

describe("applySSLDialogEdits - terminal message not duplicated", () => {
    // A node ending in NMessage/GMessage/BMessage is a terminal: the message has a real source statement,
    // so a structural save must leave it untouched, never re-append it as if it were a newly-added option.
    const SRC_MSG = `procedure Node001 begin\n    NOption(101, Node002, 4);\nend\nprocedure Node002 begin\n    Reply(200);\n    NMessage(201);\nend\nprocedure Node003 begin Reply(300); end\nprocedure talk_p_proc begin\n    call Node001;\nend\n`;

    it("does not duplicate a node's existing terminal NMessage when another node is edited", async () => {
        const original = modelFromSSL(await parseDialog(SRC_MSG));
        const edited = structuredCloneModel(original);
        // Edit Node001 only; nodeOps still runs over Node002 (which holds the terminal NMessage).
        edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!.target = {
            kind: "state",
            stateId: "Node003",
        };
        const out = applySSLDialogEdits(SRC_MSG, edited, original);
        expect((out.match(/NMessage\(201\)/g) ?? []).length).toBe(1); // appears exactly once
        expect(out).toContain("NOption(101, Node003, 4)"); // the actual edit applied
    });

    it("does not duplicate the terminal NMessage when the holding node is renamed", async () => {
        const original = modelFromSSL(await parseDialog(SRC_MSG));
        const edited = structuredCloneModel(original);
        const n2 = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        n2.renamedFrom = "Node002";
        n2.id = "Node777";
        for (const s of edited.roots[0]!.states)
            for (const c of s.choices)
                if (c.target.kind === "state" && c.target.stateId === "Node002")
                    c.target = { kind: "state", stateId: "Node777" };
        const out = applySSLDialogEdits(SRC_MSG, edited, original);
        expect((out.match(/NMessage\(201\)/g) ?? []).length).toBe(1);
        expect(out).toContain("procedure Node777 begin");
    });
});

describe("modelFromSSL node-wiring projection", () => {
    it("sets isEntry from entryIds, carries nameRange, and exposes entryCalls/anchor", async () => {
        const src = `procedure Node001 begin\n    NOption(101, Node002, 4);\nend\nprocedure Node002 begin Reply(200); end\nprocedure talk_p_proc begin call Node001; end\n`;
        const model = modelFromSSL(await parseDialog(src));
        const n1 = model.roots[0]!.states.find((s) => s.id === "Node001")!;
        const n2 = model.roots[0]!.states.find((s) => s.id === "Node002")!;
        expect(n1.isEntry).toBe(true); // talk_p_proc calls Node001
        expect(n2.isEntry).toBe(false); // reached only by an option
        expect(n1.nameRange).toBeDefined();
        expect(model.entryCalls?.[0]?.name).toBe("Node001");
        expect(model.entryCallAnchor).toBeDefined();
    });
});

describe("duplicateState - SSL (share refs)", () => {
    const DUP_SRC = `procedure Node001;\nprocedure Node002;\n\nprocedure Node001 begin\n    Reply(100);\n    NOption(101, Node002, 4);\nend\nprocedure Node002 begin\n    Reply(200);\nend\nprocedure talk_p_proc begin\n    call Node001;\nend\n`;

    it("clones a faithful SSL node as a pending-new node that shares the original's @N refs", async () => {
        const model = modelFromSSL(await parseDialog(DUP_SRC));
        const n1 = model.roots[0]!.states.find((s) => s.id === "Node001")!;
        const copy = duplicateState(model, n1)!;
        expect(copy).not.toBeNull();
        expect(copy.id).toBe("Node003"); // nextSslNodeId (max Node### + 1), not "Node001_copy"
        expect(copy.procRange).toBeUndefined(); // pending-new: no source procedure to splice over
        expect(copy.text).toBe(n1.text); // shares the reply @N ref (no new id)
        expect(copy.choices.map((c) => c.text)).toEqual(n1.choices.map((c) => c.text)); // shares option @N refs
        expect(copy.choices.every((c) => c.id.startsWith("Node003#"))).toBe(true); // choices re-id'd to the copy
    });

    it("save allocates NO new ids for the duplicate (the refs are shared, not copied)", async () => {
        const model = modelFromSSL(await parseDialog(DUP_SRC));
        duplicateState(model, model.roots[0]!.states.find((s) => s.id === "Node001")!);
        const created = allocateNodeIds(model, {}); // panel.save runs this; an all-@N node yields nothing new
        expect(created.newMessages).toEqual({});
    });

    it("a duplicated entry node is NOT auto-wired as a second dialog entry", async () => {
        const original = modelFromSSL(await parseDialog(DUP_SRC));
        expect(original.roots[0]!.states.find((s) => s.id === "Node001")!.isEntry).toBe(true); // called by talk_p_proc
        const edited = structuredCloneModel(original);
        const copy = duplicateState(edited, edited.roots[0]!.states.find((s) => s.id === "Node001")!)!;
        // The copy is an orphan to wire deliberately (and stays visible - parser keeps unreachable dialog
        // nodes), never a silent second conversation start.
        expect(copy.isEntry).toBeFalsy();
        const out = applySSLDialogEdits(DUP_SRC, edited, original);
        expect(out).not.toContain("call Node003;"); // talk_p_proc untouched
    });

    it("splices the duplicated procedure into the .ssl sharing the refs, original intact, re-parseable", async () => {
        const original = modelFromSSL(await parseDialog(DUP_SRC));
        const edited = structuredCloneModel(original);
        duplicateState(edited, edited.roots[0]!.states.find((s) => s.id === "Node001")!);
        const out = applySSLDialogEdits(DUP_SRC, edited, original);
        expect(out).toMatch(/procedure Node003 begin/); // new procedure spliced in
        expect((out.match(/Reply\(100\)/g) ?? []).length).toBe(2); // shared reply ref now in both nodes
        expect((out.match(/NOption\(101, Node002, 4\)/g) ?? []).length).toBe(2); // shared option ref in both
        expect((out.match(/procedure Node001 begin/g) ?? []).length).toBe(1); // original untouched
        const reparsed = modelFromSSL(await parseDialog(out));
        expect(reparsed.roots[0]!.states.some((s) => s.id === "Node003")).toBe(true);
    });
});

describe("applySSLDialogEdits - condition edit-text", () => {
    const SRC_COND = `procedure Node001 begin
    if (local_var(LVAR_x) == 0) then
        NOption(102, Node002, 4);
end
procedure Node002 begin Reply(200); end
procedure talk_p_proc begin call Node001; end
`;

    it("edits an existing single-call if condition in place", async () => {
        const original = modelFromSSL(await parseDialog(SRC_COND));
        const edited = structuredCloneModel(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        const opt = n1.choices.find((c) => c.condition !== undefined)!;
        expect(opt).toBeDefined(); // confirm the fixture has a conditional option with condRange
        opt.condition = "(local_var(LVAR_x) == 1)";
        const out = applySSLDialogEdits(SRC_COND, edited, original);
        expect(out).toContain("if (local_var(LVAR_x) == 1) then");
        expect(out).toContain("NOption(102, Node002, 4)");
        expect(out).not.toContain("== 0) then");
    });
});

describe("applySSLDialogEdits - condition wrap", () => {
    const SRC_WRAP = `procedure Node001 begin
    NOption(101, Node002, 4);
end
procedure Node002 begin Reply(200); end
procedure talk_p_proc begin call Node001; end
`;

    it("wraps an unconditional option in a new if when a condition is added", async () => {
        const original = modelFromSSL(await parseDialog(SRC_WRAP));
        const edited = structuredCloneModel(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        const opt = n1.choices.find((c) => c.callRange !== undefined)!;
        expect(opt).toBeDefined();
        opt.condition = "global_var(GVAR_z) == 2";
        const out = applySSLDialogEdits(SRC_WRAP, edited, original);
        expect(out).toContain("if (global_var(GVAR_z) == 2) then");
        expect(out).toMatch(/if \(global_var\(GVAR_z\) == 2\) then\s*\n\s*NOption\(101, Node002, 4\);/);
        // must not be duplicated - wrapped option appears exactly once
        expect(out.match(/NOption\(101,/g)!.length).toBe(1);
    });
});

describe("applySSLDialogEdits - condition unwrap", () => {
    const SRC_UNWRAP = `procedure Node001 begin
    if (local_var(LVAR_x) == 0) then
        NOption(102, Node002, 4);
end
procedure Node002 begin Reply(200); end
procedure talk_p_proc begin call Node001; end
`;

    it("unwraps a single-call if when its condition is cleared", async () => {
        const original = modelFromSSL(await parseDialog(SRC_UNWRAP));
        const edited = structuredCloneModel(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        const opt = n1.choices.find((c) => c.condition !== undefined)!;
        expect(opt).toBeDefined();
        opt.condition = undefined;
        const out = applySSLDialogEdits(SRC_UNWRAP, edited, original);
        expect(out).not.toContain("if (local_var(LVAR_x) == 0) then");
        expect(out).toContain("NOption(102, Node002, 4);");
        expect(out.match(/NOption\(102,/g)!.length).toBe(1);
    });
});

describe("serializeCond", () => {
    it("ensures exactly one paren layer", () => {
        expect(serializeCond("global_var(X) == 1")).toBe("(global_var(X) == 1)");
        expect(serializeCond("(global_var(X) == 1)")).toBe("(global_var(X) == 1)");
    });

    it("wraps a compound expression where parens close before the end", () => {
        expect(serializeCond("(a) and (b)")).toBe("((a) and (b))");
    });
});

describe("serializeSSLConditionalOption", () => {
    it("serializes a conditional option as an if/then single statement", () => {
        const choice = { id: "c", text: "@102", target: { kind: "state", stateId: "Node003" }, skill: 4 } as any;
        const out = serializeSSLConditionalOption(choice, 102, "global_var(GVAR_x) == 1", "    ");
        expect(out).toBe("if (global_var(GVAR_x) == 1) then\n        NOption(102, Node003, 4);");
    });
});
