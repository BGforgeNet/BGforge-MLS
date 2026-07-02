import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";
import { modelFromSSL, type DialogModel } from "../../shared/dialog-model";
import {
    applySSLDialogEdits,
    eligibleToDelete,
    isLocalNewSSLNode,
    verifySSLEditApplied,
} from "../../shared/dialog-ssl-edit";
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
        // This fixture has a then-branch with a nested if inside it.
        // isFaithfulProcedure: false (has an else).
        // isBundleFaithfulProcedure: false (isBundleBranch rejects a nested IfStmt in the then-body).
        // -> Node001 is neither faithful nor bundle-faithful; structural edits are ignored.
        const src2 = `procedure Node001 begin
    if (global_var(GVAR_X) == 1) then begin
        if (local_var(LVAR_Y) == 0) then NOption(101, Node002, 4);
    end
    else begin
        NOption(102, Node003, 4);
    end
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
        // Node001 is neither faithful nor bundle-faithful -> the structural edit is ignored.
        expect(applySSLDialogEdits(src2, edited, original)).toBe(src2);
    });
});

describe("applySSLDialogEdits - reaction / low-INT variant", () => {
    it("rewrites the macro's reaction prefix, preserving args (msg id, target, skill) byte-exact", async () => {
        const original = modelFromSSL(await parseDialog(SRC));
        const edited = structuredCloneModel(original);
        edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!.reaction = "good";
        const out = applySSLDialogEdits(SRC, edited, original);
        expect(out).toContain("GOption(101, Node002, 4)");
        expect(out).toContain("NOption(102, Node003, 4)"); // the other option untouched
        expect(out).not.toContain("NOption(101"); // the macro name actually changed, not just appended-to

        const reparsed = modelFromSSL(await parseDialog(out));
        const opt = reparsed.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!;
        expect(opt.reaction).toBe("good");
        expect(opt.skill).toBe(4);
        expect(verifySSLEditApplied(edited, reparsed)).toEqual({ ok: true });
    });

    it("toggles low-INT ON: drops the IQ arg (Low is 2-arg, IQ hardcoded to the engine's LOW_IQ)", async () => {
        const original = modelFromSSL(await parseDialog(SRC));
        const edited = structuredCloneModel(original);
        edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!.lowIq = true;
        const out = applySSLDialogEdits(SRC, edited, original);
        expect(out).toContain("NLowOption(101, Node002)");
        expect(out).not.toContain("NLowOption(101, Node002, 4)"); // arg dropped, not merely appended-to

        const reparsed = modelFromSSL(await parseDialog(out));
        const opt = reparsed.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!;
        expect(opt.lowIq).toBe(true);
        expect(opt.reaction).toBe("neutral");
        expect(verifySSLEditApplied(edited, reparsed)).toEqual({ ok: true });
    });

    it("toggles low-INT OFF: inserts the existing skill (or 0 when absent) as the IQ arg", async () => {
        const SRC_LOW = `procedure Node001 begin
    NLowOption(101, Node002);
end
procedure Node002 begin Reply(200); end
procedure talk_p_proc begin call Node001; end
`;
        const original = modelFromSSL(await parseDialog(SRC_LOW));
        const edited = structuredCloneModel(original);
        const opt = edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!;
        expect(opt.skill).toBeUndefined(); // NLowOption carries no explicit skill arg to preserve
        opt.lowIq = false;
        const out = applySSLDialogEdits(SRC_LOW, edited, original);
        expect(out).toContain("NOption(101, Node002, 0)");

        const reparsed = modelFromSSL(await parseDialog(out));
        const reOpt = reparsed.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!;
        expect(reOpt.lowIq).toBeUndefined();
        expect(reOpt.skill).toBe(0);
        expect(verifySSLEditApplied(edited, reparsed)).toEqual({ ok: true });
    });

    it("applies a reaction change and a low-INT toggle together (e.g. N -> GLow) in one save", async () => {
        const original = modelFromSSL(await parseDialog(SRC));
        const edited = structuredCloneModel(original);
        const opt = edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!;
        opt.reaction = "good";
        opt.lowIq = true;
        const out = applySSLDialogEdits(SRC, edited, original);
        expect(out).toContain("GLowOption(101, Node002)");

        const reparsed = modelFromSSL(await parseDialog(out));
        const reOpt = reparsed.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!;
        expect(reOpt.reaction).toBe("good");
        expect(reOpt.lowIq).toBe(true);
        expect(verifySSLEditApplied(edited, reparsed)).toEqual({ ok: true });
    });

    it("keeps the enclosing if-condition intact when only the reaction changes on a conditional option", async () => {
        const SRC_COND = `procedure Node001 begin
    if (global_var(GVAR_X) == 1) then NOption(101, Node002, 4);
end
procedure Node002 begin Reply(200); end
procedure talk_p_proc begin call Node001; end
`;
        const original = modelFromSSL(await parseDialog(SRC_COND));
        const edited = structuredCloneModel(original);
        const opt = edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!;
        expect(opt.condition).toContain("GVAR_X");
        opt.reaction = "bad";
        const out = applySSLDialogEdits(SRC_COND, edited, original);
        expect(out).toContain("if (global_var(GVAR_X) == 1) then BOption(101, Node002, 4);");

        const reparsed = modelFromSSL(await parseDialog(out));
        const reOpt = reparsed.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!;
        expect(reOpt.reaction).toBe("bad");
        expect(reOpt.condition).toContain("GVAR_X");
        expect(verifySSLEditApplied(edited, reparsed)).toEqual({ ok: true });
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
            "procedure Node001 begin\n    NOption(101, Node002, 4);\n    NOption(500, Node002, 0);\nend",
        );
        expect(out).toContain("NOption(101, Node002, 4)"); // survivor intact
        expect(out).toContain("NOption(500, Node002, 0);"); // added, well-formed (no overlap corruption)
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

    it("removes the forward declaration too when a node is deleted (no orphan decl)", async () => {
        // Real SSL forward-declares every procedure at the top. Deleting a node must remove its
        // forward declaration as well, or the file keeps an orphan `procedure NodeX;` with no
        // definition (harmless-to-compile-error depending on sslc). SRC3 above has no forward
        // decls, so it could not catch this; this fixture mirrors real SSL.
        const src = `procedure Node001;
procedure Node002;
procedure Node003;
procedure talk_p_proc begin call Node001; end
procedure Node001 begin
    NOption(101, Node002, 4);
    NOption(102, Node003, 4);
end
procedure Node002 begin Reply(200); end
procedure Node003 begin Reply(300); end
`;
        const original = modelFromSSL(await parseDialog(src));
        const edited = structuredCloneModel(original);
        const root = edited.roots[0]!;
        root.states = root.states.filter((s) => s.id !== "Node002");
        for (const s of root.states)
            for (const c of s.choices)
                if (c.target.kind === "state" && c.target.stateId === "Node002") c.target = { kind: "exit" };
        const out = applySSLDialogEdits(src, edited, original);
        // The delete must leave NO residue of Node002 - definition, forward declaration, or reference.
        expect(out).not.toContain("procedure Node002 begin"); // definition gone
        expect(out).not.toContain("procedure Node002;"); // forward declaration gone (the bug)
        expect(out).not.toMatch(/\bNode002\b/); // zero dangling symbols anywhere
        // Survivors intact.
        expect(out).toContain("procedure Node003;");
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

describe("isLocalNewSSLNode", () => {
    it("classifies a freshly-added node (no source span) as locally-new, so the editor may edit it at once", () => {
        // The reported bug: a new node has no `faithful` flag (only the parser sets it), so structEditable
        // greyed out delete/duplicate/add-option until a save round-trip. A node we created ourselves is
        // fully known and safely editable by construction - this predicate is what unblocks it.
        expect(isLocalNewSSLNode({ id: "Node050", text: "", choices: [] })).toBe(true);
    });

    it("still counts a committed new node (spliced once, no procRange yet) as locally-new and editable", () => {
        // `committed` suppresses RE-splicing on the next save; it does not make the node uneditable - it is
        // still ours to edit and delete before any re-parse gives it a real procRange.
        expect(isLocalNewSSLNode({ id: "Node050", text: "@1", choices: [], committed: true })).toBe(true);
    });

    it("rejects a parsed node (has a procRange), a derived node, and a renamed node", () => {
        expect(isLocalNewSSLNode({ id: "Node001", text: "@1", choices: [], procRange: { start: 0, end: 1 } })).toBe(
            false,
        );
        expect(isLocalNewSSLNode({ id: "L", text: "", choices: [], derivedFrom: "Node001" })).toBe(false);
        expect(isLocalNewSSLNode({ id: "Node002", text: "", choices: [], renamedFrom: "Node001" })).toBe(false);
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

    // Minimal hand-built model: one node with one option carrying a specific condition.
    // verifySSLEditApplied only iterates roots/states/choices, so no SSL spans are needed.
    const modelWithOptionCondition = (nodeId: string, msgId: number, condition: string): DialogModel => ({
        format: "fallout-ssl",
        editable: true,
        roots: [
            {
                id: "root",
                label: "",
                kind: "dialog",
                states: [
                    {
                        id: nodeId,
                        text: `@${msgId}`,
                        choices: [
                            {
                                id: `${nodeId}#opt0`,
                                text: "@999",
                                target: { kind: "exit" },
                                condition,
                            },
                        ],
                    },
                ],
            },
        ],
    });

    it("verify flags a condition that did not land as intended", () => {
        const intended = modelWithOptionCondition("Node001", 102, "(local_var(LVAR_x) == 1)");
        const actual = modelWithOptionCondition("Node001", 102, "(local_var(LVAR_x) == 0)"); // stale
        const res = verifySSLEditApplied(intended, actual);
        expect(res.ok).toBe(false);
    });

    it("verify passes when conditions match", () => {
        const intended = modelWithOptionCondition("Node001", 102, "(x)");
        const actual = modelWithOptionCondition("Node001", 102, "(x)");
        expect(verifySSLEditApplied(intended, actual).ok).toBe(true);
    });

    it("verify treats a bare condition as matching its serialized parenthesized form", () => {
        // After a wrap, the intended model carries the user's bare condition while the reparse of the
        // saved .ssl carries the serializeCond-parenthesized form. Verify must canonicalize parens so it
        // does not flag this cosmetic difference as a failed save.
        const intended = modelWithOptionCondition("Node001", 102, "local_var(LVAR_Z) == 5");
        const actual = modelWithOptionCondition("Node001", 102, "(local_var(LVAR_Z) == 5)");
        expect(verifySSLEditApplied(intended, actual).ok).toBe(true);
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

    it("adds a call when a node is renamed AND becomes an entry in the same save", async () => {
        // The combined op: a node that gains entry status for the first time WHILE being renamed.
        // Its new id has no prior entry call (the rename had nothing to rewrite), so the addition
        // path must still wire it in - the `!s.renamedFrom` exclusion used to drop it silently.
        const src = `procedure Node001 begin\n    Reply(100);\nend\nprocedure Node002 begin\n    Reply(200);\nend\nprocedure talk_p_proc begin\n    call Node001;\nend\n`;
        const original = modelFromSSL(await parseDialog(src));
        const edited = structuredCloneModel(original);
        const n2 = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        n2.renamedFrom = "Node002";
        n2.id = "Node077";
        n2.isEntry = true;
        const out = applySSLDialogEdits(src, edited, original);
        expect(out).toContain("procedure Node077 begin");
        expect(out).not.toContain("procedure Node002 begin");
        // The new entry call is wired into talk_p_proc after the existing entry call.
        expect(out).toContain("procedure talk_p_proc begin\n    call Node001;\n    call Node077;\nend");
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

    it("removes ALL inbound call sites when a node called twice is deleted", async () => {
        // Twin of the rename bug on the delete side: a surviving node calls the deleted node twice.
        // Both top-level `call <node>;` statements must be spliced out, or one is left dangling.
        const src = `procedure Node001 begin\n    call Node002;\n    call Node002;\nend\nprocedure Node002 begin Reply(200); end\nprocedure talk_p_proc begin\n    call Node001;\nend\n`;
        const original = modelFromSSL(await parseDialog(src));
        const edited = structuredCloneModel(original);
        edited.roots[0]!.states = edited.roots[0]!.states.filter((s) => s.id !== "Node002");
        const out = applySSLDialogEdits(src, edited, original);
        expect(out).not.toContain("procedure Node002");
        expect(out).not.toContain("call Node002;"); // neither inbound call left dangling
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

    it("rewrites EVERY call site when a node is called twice from one procedure", async () => {
        // A node may `call X;` more than once (e.g. one call per if-branch). callTargets is deduped to a
        // single graph edge, but rename must still rewrite all call-statement sites - missing the 2nd leaves a
        // dangling `call OldName;` that sslc rejects. 49 such node-to-node sites exist in the real corpus.
        const src = `procedure Node001 begin\n    Reply(100);\nend\nprocedure Node002 begin\n    call Node001;\n    call Node001;\nend\nprocedure talk_p_proc begin\n    call Node002;\nend\n`;
        const original = modelFromSSL(await parseDialog(src));
        const edited = structuredCloneModel(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        n1.renamedFrom = "Node001";
        n1.id = "Node009";
        for (const s of edited.roots[0]!.states)
            for (const c of s.choices)
                if (c.target.kind === "state" && c.target.stateId === "Node001")
                    c.target = { kind: "state", stateId: "Node009" };
        const out = applySSLDialogEdits(src, edited, original);
        expect(out).toContain("procedure Node009 begin");
        expect(out).not.toContain("call Node001;"); // neither of the two call sites is left dangling
        expect((out.match(/call Node009;/g) ?? []).length).toBe(2); // both rewritten
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

describe("bundle node model mapping", () => {
    const BUNDLE_SRC = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin
        set_local_var(LVAR_0,1);
        Reply(120);
        NOption(122, Node915, 4);
    end
    else begin
        Reply(121);
        NOption(124, Node915, 4);
    end
end
procedure talk_p_proc begin call Node002; end
`;
    it("carries branches and bundleFaithful onto the state, keeping the flat choices union", async () => {
        const model = modelFromSSL(await parseDialog(BUNDLE_SRC));
        const s = model.roots[0]!.states.find((x) => x.id === "Node002")!;
        expect(s.bundleFaithful).toBe(true);
        expect(s.branches).toBeDefined();
        const [ifB, elseB] = s.branches!;
        expect(ifB!.kind).toBe("if");
        expect(ifB!.condition).toBe("(local_var(LVAR_0) == 0)");
        expect(ifB!.opaque).toEqual(["set_local_var(LVAR_0,1);"]);
        // Every choiceId resolves to a real flat choice.
        const ids = new Set(s.choices.map((c) => c.id));
        for (const b of s.branches!) for (const cid of b.choiceIds) expect(ids.has(cid)).toBe(true);
        expect(elseB!.kind).toBe("else");
        // Flat choices still hold both options (graph edges unchanged).
        expect(s.choices.filter((c) => c.target.kind === "state").length).toBe(2);
    });

    it("threads each if-branch conditionRange onto the model", async () => {
        const model = modelFromSSL(await parseDialog(BUNDLE_SRC));
        const s = model.roots[0]!.states.find((x) => x.id === "Node002")!;
        const ifB = s.branches!.find((b) => b.kind === "if")!;
        const elseB = s.branches!.find((b) => b.kind === "else")!;
        expect(ifB.conditionRange).toBeDefined();
        expect(elseB.conditionRange).toBeUndefined();
    });

    it("threads each branch insertAnchor onto the model", async () => {
        const model = modelFromSSL(await parseDialog(BUNDLE_SRC));
        const s = model.roots[0]!.states.find((x) => x.id === "Node002")!;
        for (const b of s.branches!) expect(b.insertAnchor).toBeDefined();
    });

    it("threads whole-branch spans onto the model", async () => {
        const model = modelFromSSL(await parseDialog(BUNDLE_SRC));
        const s = model.roots[0]!.states.find((x) => x.id === "Node002")!;
        const ifB = s.branches!.find((b) => b.kind === "if")!;
        const elseB = s.branches!.find((b) => b.kind === "else")!;
        expect(ifB.stmtRange).toBeDefined();
        expect(ifB.thenBlockEnd).toBeDefined();
        expect(elseB.elseClauseRange).toBeDefined();
    });
});

describe("applySSLDialogEdits - Task 7: compose + conditional reorder", () => {
    // Fixture: one flat option (101 -> Node002) plus one single-call-if conditional option (102 -> Node003).
    const SRC_T7 = `procedure Node001 begin
    NOption(101, Node002, 4);
    if (local_var(LVAR_x) == 0) then
        NOption(102, Node003, 4);
end
procedure Node002 begin Reply(200); end
procedure Node003 begin Reply(300); end
procedure talk_p_proc begin call Node001; end
`;

    // Test A: compose condition edit-text with target retarget on the same option. The two splices
    // touch disjoint spans (condRange vs targetRange inside callRange), so this should pass without
    // any fix - it is a regression guard.
    it("composes condition edit-text with retarget on the same conditional option", async () => {
        const original = modelFromSSL(await parseDialog(SRC_T7));
        const edited = structuredCloneModel(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        const opt = n1.choices.find((c) => c.condition !== undefined)!;
        expect(opt).toBeDefined();
        opt.condition = "(local_var(LVAR_x) == 5)";
        opt.target = { kind: "state", stateId: "Node002" };
        const out = applySSLDialogEdits(SRC_T7, edited, original);
        expect(out).toContain("if (local_var(LVAR_x) == 5) then");
        expect(out).toContain("NOption(102, Node002, 4);");
    });

    // Test B: reorder so the conditional option (102) appears before the flat option (101) in the
    // model. The survivor loop should NOT move the conditional option's call text into the flat slot,
    // because the if-wrapper stays at its source position. Without the fix, the call texts swap and
    // the if-wrapper ends up around option 101 - option 102 becomes flat (corruption). The fix pins
    // conditional survivors to their own source slot so the wrapper always wraps its own call.
    it("does not corrupt a conditional option when reordered among flat options", async () => {
        const original = modelFromSSL(await parseDialog(SRC_T7));
        const edited = structuredCloneModel(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        // Move conditional option (102) before flat option (101) in the model, mirroring moveReply.
        n1.choices.reverse();
        const out = applySSLDialogEdits(SRC_T7, edited, original);
        const reparsed = modelFromSSL(await parseDialog(out));
        const n1r = reparsed.roots[0]!.states.find((s) => s.id === "Node001")!;
        // Identify each option by its target node (stable across a pure reorder).
        const opt102 = n1r.choices.find(
            (c) => c.callRange !== undefined && c.target.kind === "state" && c.target.stateId === "Node003",
        );
        const opt101 = n1r.choices.find(
            (c) => c.callRange !== undefined && c.target.kind === "state" && c.target.stateId === "Node002",
        );
        // Each option must keep its own condition: 102 stays conditional, 101 stays unconditional.
        expect(opt102?.condition).toBeDefined();
        expect(opt101?.condition).toBeUndefined();
    });
});

describe("bundle node in-place retarget", () => {
    const SRC_BUNDLE = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin
        set_local_var(LVAR_0,1);
        Reply(120);
        NOption(122, Node915, 4);
    end
    else begin
        Reply(121);
        NOption(124, Node915, 4);
    end
end
procedure Node915 begin Reply(900); end
procedure Node999 begin Reply(999); end
procedure talk_p_proc begin call Node002; end
`;
    it("retargets an else-branch option in place, preserving the condition skeleton and side-effect byte-exact", async () => {
        const original = modelFromSSL(await parseDialog(SRC_BUNDLE));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        // The else-branch option (NOption 124 -> Node915) retargeted to Node999.
        const elseOpt = node.choices.find(
            (c) => c.target.kind === "state" && c.target.stateId === "Node915" && c.condition?.startsWith("!"),
        )!;
        elseOpt.target = { kind: "state", stateId: "Node999" };
        const out = applySSLDialogEdits(SRC_BUNDLE, edited, original);
        expect(out).toContain("NOption(124, Node999, 4)"); // retargeted
        expect(out).toContain("NOption(122, Node915, 4)"); // then-branch option untouched
        expect(out).toContain("set_local_var(LVAR_0,1);"); // side-effect byte-exact
        expect(out).toContain("else begin"); // if/else skeleton intact
        const actual = modelFromSSL(await parseDialog(out));
        expect(verifySSLEditApplied(edited, actual)).toEqual({ ok: true });
    });
});

describe("read-only floor stays put", () => {
    // A node with a nested `if` inside a then-begin block: not faithful (nested structure),
    // not bundle-faithful (nested if inside the branch body). The read-only gate must block
    // any structural edit on it - retarget returns the source byte-exact.
    const SRC_FLOOR = `procedure Node002 begin
    if (global_var(GVAR_X) == 1) then begin
        if (global_var(GVAR_Y) == 1) then Reply(1);
        NOption(2, Node915, 4);
    end
end
procedure Node915 begin Reply(900); end
procedure Node999 begin Reply(999); end
procedure talk_p_proc begin call Node002; end
`;
    it("a nested-if node is neither faithful nor bundle-faithful and retarget leaves source unchanged", async () => {
        const data = await parseDialog(SRC_FLOOR);
        const n = data.nodes.find((x) => x.name === "Node002")!;
        expect(n.faithful).not.toBe(true);
        expect(n.bundleFaithful).toBeUndefined();
        const original = modelFromSSL(data);
        const edited = structuredClone(original);
        const opt = edited.roots[0]!.states.find((s) => s.id === "Node002")!.choices.find(
            (c) => c.target.kind === "state",
        )!;
        opt.target = { kind: "state", stateId: "Node999" };
        expect(applySSLDialogEdits(SRC_FLOOR, edited, original)).toBe(SRC_FLOOR);
    });
});

describe("applySSLDialogEdits - bundle branch condition edit", () => {
    const SRC_BC = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin
        set_local_var(LVAR_0,1);
        Reply(120);
        NOption(122, Node915, 4);
    end
    else begin
        Reply(121);
        NOption(124, Node915, 4);
    end
end
procedure Node915 begin Reply(900); end
procedure talk_p_proc begin call Node002; end
`;
    it("edits an if-branch condition in place, leaving else/options/side-effects byte-exact", async () => {
        const original = modelFromSSL(await parseDialog(SRC_BC));
        const edited = structuredClone(original);
        const ifB = edited.roots[0]!.states.find((s) => s.id === "Node002")!.branches!.find((b) => b.kind === "if")!;
        ifB.condition = "(local_var(LVAR_0) == 2)";
        const out = applySSLDialogEdits(SRC_BC, edited, original);
        expect(out).toContain("if (local_var(LVAR_0) == 2) then");
        expect(out).not.toContain("== 0) then");
        expect(out).toContain("set_local_var(LVAR_0,1);"); // side-effect intact
        expect(out).toContain("NOption(122, Node915, 4)"); // option intact
        expect(out).toContain("else begin"); // skeleton intact
    });

    // Two consecutive ifs (no else); a side-effect in the first branch makes the node non-faithful
    // but still bundle-faithful - so branches is populated for both ifs.
    const SRC_TWO_IF = `procedure Node002 begin
    if (global_var(GVAR_A) == 1) then begin
        set_local_var(LVAR_0, 1);
        NOption(101, Node915, 4);
    end
    if (global_var(GVAR_B) == 1) then begin
        NOption(102, Node915, 4);
    end
end
procedure Node915 begin Reply(900); end
procedure talk_p_proc begin call Node002; end
`;
    it("edits each sibling if-condition independently", async () => {
        const original = modelFromSSL(await parseDialog(SRC_TWO_IF));
        const edited = structuredClone(original);
        const ifs = edited.roots[0]!.states.find((s) => s.id === "Node002")!.branches!.filter((b) => b.kind === "if");
        expect(ifs).toHaveLength(2);
        ifs[1]!.condition = "(global_var(GVAR_B) == 5)";
        const out = applySSLDialogEdits(SRC_TWO_IF, edited, original);
        expect(out).toContain("if (global_var(GVAR_A) == 1) then"); // first untouched
        expect(out).toContain("if (global_var(GVAR_B) == 5) then"); // second edited
    });
});

describe("bundleNodeOps - within-branch remove", () => {
    const SRC_BR = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin
        set_local_var(LVAR_0,1);
        Reply(120);
        NOption(122, Node915, 4);
        NOption(123, Node999, 4);
    end
    else begin
        Reply(121);
        NOption(124, Node915, 4);
    end
end
procedure Node915 begin Reply(900); end
procedure Node999 begin Reply(999); end
procedure talk_p_proc begin call Node002; end
`;
    it("removes one option from the then-branch, leaving the rest of the branch + else + side-effect byte-exact", async () => {
        const original = modelFromSSL(await parseDialog(SRC_BR));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        // Drop the then-branch option NOption(123, Node999): remove it from both choices and its branch.
        const ifBranch = node.branches!.find((b) => b.kind === "if")!;
        const tgt = node.choices.find(
            (c) =>
                c.target.kind === "state" &&
                c.target.stateId === "Node999" &&
                c.condition &&
                !c.condition.startsWith("!"),
        )!;
        node.choices = node.choices.filter((c) => c.id !== tgt.id);
        ifBranch.choiceIds = ifBranch.choiceIds.filter((id) => id !== tgt.id);
        const out = applySSLDialogEdits(SRC_BR, edited, original);
        expect(out).not.toContain("NOption(123, Node999, 4)"); // removed
        expect(out).toContain("NOption(122, Node915, 4)"); // kept (then-branch)
        expect(out).toContain("NOption(124, Node915, 4)"); // kept (else-branch)
        expect(out).toContain("set_local_var(LVAR_0,1);"); // side-effect byte-exact
        expect(out).toContain("else begin");
        const actual = modelFromSSL(await parseDialog(out));
        expect(verifySSLEditApplied(edited, actual)).toEqual({ ok: true });
    });
});

describe("bundleNodeOps - within-branch reorder", () => {
    it("reorders two options within the then-branch", async () => {
        const SRC_RE = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin
        NOption(122, Node915, 4);
        NOption(123, Node999, 4);
    end
    else begin NOption(124, Node915, 4); end
end
procedure Node915 begin Reply(900); end
procedure Node999 begin Reply(999); end
procedure talk_p_proc begin call Node002; end
`;
        const original = modelFromSSL(await parseDialog(SRC_RE));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        const ifB = node.branches!.find((b) => b.kind === "if")!;
        ifB.choiceIds = [ifB.choiceIds[1]!, ifB.choiceIds[0]!]; // swap the two then-branch options
        const out = applySSLDialogEdits(SRC_RE, edited, original);
        const i122 = out.indexOf("NOption(122");
        const i123 = out.indexOf("NOption(123");
        expect(i123).toBeGreaterThan(-1);
        expect(i123).toBeLessThan(i122); // 123 now precedes 122 in the then-branch
        expect(out).toContain("NOption(124, Node915, 4)"); // else untouched
    });
});

describe("bundleNodeOps - within-branch add", () => {
    it("adds a new option to the else-branch, inside the else block", async () => {
        const SRC_BA = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin NOption(122, Node915, 4); end
    else begin NOption(124, Node915, 4); end
end
procedure Node915 begin Reply(900); end
procedure Node999 begin Reply(999); end
procedure talk_p_proc begin call Node002; end
`;
        const original = modelFromSSL(await parseDialog(SRC_BA));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        const elseB = node.branches!.find((b) => b.kind === "else")!;
        // New option (no source range, allocated @id text) added to the else branch.
        const newId = `${node.id}#new1`;
        const newChoice = {
            id: newId,
            text: "@301",
            target: { kind: "state" as const, stateId: "Node999" },
            reaction: "neutral" as const,
        };
        node.choices.push(newChoice as (typeof node.choices)[number]);
        elseB.choiceIds = [...elseB.choiceIds, newId];
        const out = applySSLDialogEdits(SRC_BA, edited, original);
        // The new option lands inside the else block (after NOption(124,...), before the else `end`).
        const elseStart = out.indexOf("else begin");
        const i124 = out.indexOf("NOption(124", elseStart);
        const i301 = out.indexOf("NOption(301", elseStart);
        expect(i301).toBeGreaterThan(i124);
        expect(out.indexOf("end", i301)).toBeGreaterThan(i301); // still before a closing end
        expect(out).toContain("NOption(122, Node915, 4)"); // then-branch untouched
    });
});

describe("verifySSLEditApplied - bundle branch conditions", () => {
    const SRC_BC = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin Reply(120); NOption(122, Node915, 4); end
    else begin Reply(121); NOption(124, Node915, 4); end
end
procedure Node915 begin Reply(900); end
procedure talk_p_proc begin call Node002; end
`;
    it("flags an intended branch-condition edit that did not land", async () => {
        const original = modelFromSSL(await parseDialog(SRC_BC));
        const intended = structuredClone(original);
        intended.roots[0]!.states.find((s) => s.id === "Node002")!.branches!.find((b) => b.kind === "if")!.condition =
            "(local_var(LVAR_0) == 9)";
        // actual = the unchanged parse (the edit "did not land")
        const actual = modelFromSSL(await parseDialog(SRC_BC));
        expect(verifySSLEditApplied(intended, actual).ok).toBe(false);
    });
    it("treats a bare vs parenthesized branch condition as matching", async () => {
        const original = modelFromSSL(await parseDialog(SRC_BC));
        const intended = structuredClone(original);
        // intend the same condition without its outer parens; the canonicalizer must fold them
        intended.roots[0]!.states.find((s) => s.id === "Node002")!.branches!.find((b) => b.kind === "if")!.condition =
            "local_var(LVAR_0) == 0";
        const actual = modelFromSSL(await parseDialog(SRC_BC));
        expect(verifySSLEditApplied(intended, actual)).toEqual({ ok: true });
    });
});

describe("verifySSLEditApplied - branch add/remove (kind-aware fold)", () => {
    // Single-if, no else; a side-effect keeps the node bundleFaithful.
    const SRC_SIF = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin
        set_local_var(LVAR_0, 1);
        NOption(122, Node915, 4);
    end
end
procedure Node915 begin Reply(900); end
procedure Node999 begin Reply(999); end
procedure talk_p_proc begin call Node002; end
`;
    // Two sibling ifs; a side-effect in the first keeps it bundleFaithful.
    const SRC_RIF = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin
        set_local_var(LVAR_0, 1);
        NOption(122, Node915, 4);
    end
    if (local_var(LVAR_1) == 1) then begin
        NOption(301, Node999, 4);
    end
end
procedure Node915 begin Reply(900); end
procedure Node999 begin Reply(999); end
procedure talk_p_proc begin call Node002; end
`;

    it("verifies ok after a sibling-if add lands (branch-add round-trip)", async () => {
        const original = modelFromSSL(await parseDialog(SRC_SIF));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        const newOptId = "Node002#new0";
        node.choices.push({
            id: newOptId,
            text: "@301",
            target: { kind: "state" as const, stateId: "Node999" },
            condition: "(local_var(LVAR_1) == 1)",
        });
        node.branches!.push({
            kind: "if",
            condition: "(local_var(LVAR_1) == 1)",
            choiceIds: [newOptId],
            replies: [],
            opaque: [],
        });
        const out = applySSLDialogEdits(SRC_SIF, edited, original);
        const actual = modelFromSSL(await parseDialog(out));
        expect(verifySSLEditApplied(edited, actual)).toEqual({ ok: true });
    });

    it("verifies ok after a sibling-if remove lands (branch-remove round-trip)", async () => {
        const original = modelFromSSL(await parseDialog(SRC_RIF));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        const removedBranch = node.branches!.find((b) => b.kind === "if" && b.condition?.includes("LVAR_1"))!;
        const removedIds = new Set(removedBranch.choiceIds);
        node.branches = node.branches!.filter((b) => b !== removedBranch);
        node.choices = node.choices.filter((c) => !removedIds.has(c.id));
        const out = applySSLDialogEdits(SRC_RIF, edited, original);
        const actual = modelFromSSL(await parseDialog(out));
        expect(verifySSLEditApplied(edited, actual)).toEqual({ ok: true });
    });

    it("flags an intended else-add that did not land (actual = unchanged parse)", async () => {
        // Empty else branch added to intended - no new choices, so the choices-level check does
        // not trigger. Only branchKey differs (intended: if+else, actual: if only). This is the
        // case the current filter-to-if fold misses, making it the RED case for this task.
        const original = modelFromSSL(await parseDialog(SRC_SIF));
        const intended = structuredClone(original);
        const node = intended.roots[0]!.states.find((s) => s.id === "Node002")!;
        node.branches!.push({
            kind: "else",
            choiceIds: [],
            replies: [],
            opaque: [],
        });
        // actual = unchanged parse (the else add did NOT land)
        const actual = modelFromSSL(await parseDialog(SRC_SIF));
        expect(verifySSLEditApplied(intended, actual).ok).toBe(false);
    });
});

describe("bundleNodeOps - bare single-statement branch: no insertAnchor, add is no-op", () => {
    // A bundle node where the if-branch is a bare single statement (no begin/end) and the else-branch
    // is a block. The bare branch must get no insertAnchor (adding to it would require begin/end synthesis
    // the writer does not perform), so the "+ option" button is hidden and the save path emits no splice.
    const SRC_BARE = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then NOption(122, Node915, 4);
    else begin NOption(124, Node915, 4); NOption(125, Node999, 4); end
end
procedure Node915 begin Reply(900); end
procedure Node999 begin Reply(999); end
procedure talk_p_proc begin call Node002; end
`;

    it("bare then-branch has no insertAnchor; block else-branch has one", async () => {
        const data = await parseDialog(SRC_BARE);
        const node = data.nodes.find((n) => n.name === "Node002")!;
        expect(node.bundleFaithful).toBe(true);
        expect(node.branches).toBeDefined();
        const ifB = node.branches!.find((b) => b.kind === "if")!;
        const elseB = node.branches!.find((b) => b.kind === "else")!;
        expect(ifB.insertAnchor).toBeUndefined(); // bare statement: no block, no insert anchor
        expect(elseB.insertAnchor).toBeDefined(); // block branch: has insert anchor
    });

    it("add to a bare then-branch is a no-op; source is preserved byte-exact", async () => {
        const original = modelFromSSL(await parseDialog(SRC_BARE));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        const ifB = node.branches!.find((b) => b.kind === "if")!;
        // Simulate the editor allocating a new option id and adding it to the bare then-branch.
        const newId = `${node.id}#new0`;
        node.choices.push({ id: newId, text: "@999", target: { kind: "state", stateId: "Node999" } });
        ifB.choiceIds = [...ifB.choiceIds, newId];
        const out = applySSLDialogEdits(SRC_BARE, edited, original);
        // Bare branch has no insertAnchor -> add is skipped; source must be byte-exact.
        expect(out).toBe(SRC_BARE);
        // No misplaced NOption at procedure scope (the corruption the bug would produce).
        expect((out.match(/NOption\(999/g) ?? []).length).toBe(0);
    });
});

describe("branchStructureOps - add sibling if / add else (Task 5)", () => {
    // A single-if procedure with no else is parsed as `faithful` (not `bundleFaithful`) when its branch
    // contains only dialog calls. To get a bundleFaithful node we need a side-effect statement inside the
    // branch (making the whole procedure non-faithful but bundle-faithful). The set_local_var provides that.
    const SRC_SIF = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin
        set_local_var(LVAR_0, 1);
        NOption(122, Node915, 4);
    end
end
procedure Node915 begin Reply(900); end
procedure Node999 begin Reply(999); end
procedure talk_p_proc begin call Node002; end
`;

    it("adds a sibling if branch after the last original branch", async () => {
        const original = modelFromSSL(await parseDialog(SRC_SIF));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        // New option and new sibling if branch (no stmtRange -> PENDING-NEW).
        // Condition on the choice matches the branch condition so verifySSLEditApplied sees
        // the same condition in both intended and reparsed models.
        const newOptId = "Node002#new0";
        node.choices.push({
            id: newOptId,
            text: "@301",
            target: { kind: "state" as const, stateId: "Node999" },
            condition: "(local_var(LVAR_1) == 1)",
        });
        node.branches!.push({
            kind: "if",
            condition: "(local_var(LVAR_1) == 1)",
            choiceIds: [newOptId],
            replies: [],
            opaque: [],
        });
        const out = applySSLDialogEdits(SRC_SIF, edited, original);
        // New if block is present.
        expect(out).toContain("if (local_var(LVAR_1) == 1) then begin");
        expect(out).toContain("NOption(301, Node999, 0)");
        // New if appears AFTER the existing if.
        const i0 = out.indexOf("if (local_var(LVAR_0)");
        const i1 = out.indexOf("if (local_var(LVAR_1)");
        expect(i1).toBeGreaterThan(i0);
        // Original if block is byte-exact (present and unchanged).
        expect(out).toContain("if (local_var(LVAR_0) == 0) then begin");
        expect(out).toContain("NOption(122, Node915, 4)");
        // Re-parses as a bundle-faithful node.
        const reparsed = modelFromSSL(await parseDialog(out));
        expect(reparsed.roots[0]!.states.find((s) => s.id === "Node002")!.bundleFaithful).toBe(true);
        expect(verifySSLEditApplied(edited, reparsed)).toEqual({ ok: true });
    });

    it("adds an else branch after the then-block, original if byte-exact", async () => {
        const original = modelFromSSL(await parseDialog(SRC_SIF));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        // New option and new else branch (no elseClauseRange -> PENDING-NEW).
        const newOptId = "Node002#new0";
        node.choices.push({
            id: newOptId,
            text: "@301",
            target: { kind: "state" as const, stateId: "Node999" },
        });
        node.branches!.push({
            kind: "else",
            choiceIds: [newOptId],
            replies: [],
            opaque: [],
        });
        const out = applySSLDialogEdits(SRC_SIF, edited, original);
        // Else block appears in the output.
        expect(out).toContain("else begin");
        expect(out).toContain("NOption(301, Node999, 0)");
        // The else is injected after the then-block end - the else `end` appears before the proc `end`.
        const iElse = out.indexOf("else begin");
        const iEnd = out.lastIndexOf("\nend\n");
        expect(iElse).toBeGreaterThan(0);
        expect(iElse).toBeLessThan(iEnd);
        // Original if is byte-exact in the output.
        expect(out).toContain("if (local_var(LVAR_0) == 0) then begin");
        expect(out).toContain("NOption(122, Node915, 4)");
        // Round-trip: re-parses as bundle-faithful.
        const reparsed = modelFromSSL(await parseDialog(out));
        expect(reparsed.roots[0]!.states.find((s) => s.id === "Node002")!.bundleFaithful).toBe(true);
    });

    it("empty added else branch serializes as begin end and re-parses bundle-faithful", async () => {
        const original = modelFromSSL(await parseDialog(SRC_SIF));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        // New else branch with no options (empty body).
        node.branches!.push({
            kind: "else",
            choiceIds: [],
            replies: [],
            opaque: [],
        });
        const out = applySSLDialogEdits(SRC_SIF, edited, original);
        // Empty else block injected.
        expect(out).toContain("else begin");
        // Re-parses as bundle-faithful (empty block is valid).
        const reparsed = modelFromSSL(await parseDialog(out));
        expect(reparsed.roots[0]!.states.find((s) => s.id === "Node002")!.bundleFaithful).toBe(true);
    });
});

describe("branchStructureOps - remove sibling if / remove else (Task 6)", () => {
    // Two sibling if branches: the first has a set_local_var (opaque) making the procedure
    // bundleFaithful; the second has only a dialog call (no side-effects) and is the one removed.
    const SRC_RIF = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin
        set_local_var(LVAR_0, 1);
        NOption(122, Node915, 4);
    end
    if (local_var(LVAR_1) == 1) then begin
        NOption(301, Node999, 4);
    end
end
procedure Node915 begin Reply(900); end
procedure Node999 begin Reply(999); end
procedure talk_p_proc begin call Node002; end
`;

    // If-else procedure: the if branch carries set_local_var (opaque) to keep the node bundleFaithful
    // both before and after else removal. The else block has only a dialog call (no side-effects).
    const SRC_RE = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin
        set_local_var(LVAR_0, 1);
        NOption(122, Node915, 4);
    end
    else begin
        NOption(124, Node915, 4);
    end
end
procedure Node915 begin Reply(900); end
procedure talk_p_proc begin call Node002; end
`;

    it("removes a sibling if branch (no side-effects): other branch and its options are byte-exact", async () => {
        const original = modelFromSSL(await parseDialog(SRC_RIF));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        // Remove the SECOND if branch (local_var(LVAR_1) == 1) from edited.
        const removedBranch = node.branches!.find((b) => b.kind === "if" && b.condition?.includes("LVAR_1"))!;
        const removedIds = new Set(removedBranch.choiceIds);
        node.branches = node.branches!.filter((b) => b !== removedBranch);
        node.choices = node.choices.filter((c) => !removedIds.has(c.id));
        const out = applySSLDialogEdits(SRC_RIF, edited, original);
        // The removed branch is gone.
        expect(out).not.toContain("local_var(LVAR_1)");
        expect(out).not.toContain("NOption(301");
        // The surviving branch is byte-exact.
        expect(out).toContain("if (local_var(LVAR_0) == 0) then begin");
        expect(out).toContain("set_local_var(LVAR_0, 1)");
        expect(out).toContain("NOption(122, Node915, 4)");
        // No blank lines introduced by the removal.
        expect(out).not.toMatch(/\n\n\n/);
        // Re-parses as bundleFaithful with one branch.
        const reparsed = modelFromSSL(await parseDialog(out));
        const reparsedNode = reparsed.roots[0]!.states.find((s) => s.id === "Node002")!;
        expect(reparsedNode.bundleFaithful).toBe(true);
        expect(reparsedNode.branches).toHaveLength(1);
        expect(verifySSLEditApplied(edited, reparsed)).toEqual({ ok: true });
    });

    it("removes an else branch: the if block is byte-exact, else is gone", async () => {
        const original = modelFromSSL(await parseDialog(SRC_RE));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        // Remove the else branch from edited.
        const elseBranch = node.branches!.find((b) => b.kind === "else")!;
        const removedIds = new Set(elseBranch.choiceIds);
        node.branches = node.branches!.filter((b) => b.kind !== "else");
        node.choices = node.choices.filter((c) => !removedIds.has(c.id));
        const out = applySSLDialogEdits(SRC_RE, edited, original);
        // The else clause is gone.
        expect(out).not.toContain("else");
        expect(out).not.toContain("NOption(124");
        // The if block is byte-exact (including the side-effect set_local_var).
        expect(out).toContain("if (local_var(LVAR_0) == 0) then begin");
        expect(out).toContain("set_local_var(LVAR_0, 1)");
        expect(out).toContain("NOption(122, Node915, 4)");
        // The set_local_var in the if branch keeps the node bundleFaithful after else removal.
        const reparsed = modelFromSSL(await parseDialog(out));
        const reparsedNode = reparsed.roots[0]!.states.find((s) => s.id === "Node002")!;
        expect(reparsedNode.bundleFaithful).toBe(true);
        expect(reparsedNode.branches).toHaveLength(1);
        expect(reparsedNode.branches![0]!.kind).toBe("if");
        expect(verifySSLEditApplied(edited, reparsed)).toEqual({ ok: true });
    });

    it("refuses to remove a branch that carries opaque (side-effect) statements: source is byte-exact", async () => {
        // SRC_SIF (from the add-tests above) has one if branch with set_local_var -> opaque.length == 1.
        // Attempting to remove it must produce a no-op (the writer backstop for the UI's refuse).
        const SRC_SIF_LOCAL = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin
        set_local_var(LVAR_0, 1);
        NOption(122, Node915, 4);
    end
end
procedure Node915 begin Reply(900); end
procedure Node999 begin Reply(999); end
procedure talk_p_proc begin call Node002; end
`;
        const original = modelFromSSL(await parseDialog(SRC_SIF_LOCAL));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        // Remove the only if branch from edited (simulating user deleting it).
        const removedBranch = node.branches![0]!;
        const removedIds = new Set(removedBranch.choiceIds);
        node.branches = [];
        node.choices = node.choices.filter((c) => !removedIds.has(c.id));
        const out = applySSLDialogEdits(SRC_SIF_LOCAL, edited, original);
        // Writer refuses: branch has opaque statements -> source unchanged.
        expect(out).toBe(SRC_SIF_LOCAL);
    });
});

describe("branchStructureOps - remove last if branch and add a new sibling if in one save", () => {
    // Two sibling if branches: the first has set_local_var (opaque, cannot be removed by the writer),
    // the second has only a dialog option (no opaque, removable). In a single save, REMOVE the last
    // branch (LVAR_1) AND ADD a new pending-new if branch. The ADD anchor must land at the SURVIVING
    // original's stmtRange.end, not the removed branch's end - the edge the fix guards.
    const SRC_RIF_COMBINED = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin
        set_local_var(LVAR_0, 1);
        NOption(122, Node915, 4);
    end
    if (local_var(LVAR_1) == 1) then begin
        NOption(301, Node999, 4);
    end
end
procedure Node915 begin Reply(900); end
procedure Node999 begin Reply(999); end
procedure talk_p_proc begin call Node002; end
`;

    it("removes the last if branch and adds a new sibling if in one save, anchor at surviving branch", async () => {
        const original = modelFromSSL(await parseDialog(SRC_RIF_COMBINED));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        expect(node.bundleFaithful).toBe(true);

        // Remove the last branch (LVAR_1 == 1, no opaque).
        const removedBranch = node.branches!.find((b) => b.kind === "if" && b.condition?.includes("LVAR_1"))!;
        const removedIds = new Set(removedBranch.choiceIds);
        node.branches = node.branches!.filter((b) => b !== removedBranch);
        node.choices = node.choices.filter((c) => !removedIds.has(c.id));

        // Add a new pending-new if branch with its own option.
        const newOptId = "Node002#new0";
        node.choices.push({
            id: newOptId,
            text: "@401",
            target: { kind: "state" as const, stateId: "Node999" },
            condition: "(local_var(LVAR_2) == 2)",
        });
        node.branches!.push({
            kind: "if",
            condition: "(local_var(LVAR_2) == 2)",
            choiceIds: [newOptId],
            replies: [],
            opaque: [],
        });

        const out = applySSLDialogEdits(SRC_RIF_COMBINED, edited, original);

        // Removed branch is gone.
        expect(out).not.toContain("local_var(LVAR_1)");
        expect(out).not.toContain("NOption(301");

        // New branch is present with its option.
        expect(out).toContain("if (local_var(LVAR_2) == 2) then begin");
        expect(out).toContain("NOption(401, Node999, 0)");

        // New branch appears AFTER the surviving branch (correct anchor placement).
        const iLVAR0 = out.indexOf("if (local_var(LVAR_0)");
        const iLVAR2 = out.indexOf("if (local_var(LVAR_2)");
        expect(iLVAR0).toBeGreaterThan(-1);
        expect(iLVAR2).toBeGreaterThan(iLVAR0);

        // Surviving branch is byte-exact (set_local_var side-effect intact).
        expect(out).toContain("if (local_var(LVAR_0) == 0) then begin");
        expect(out).toContain("set_local_var(LVAR_0, 1)");
        expect(out).toContain("NOption(122, Node915, 4)");

        // Round-trip: re-parses as bundleFaithful and verifySSLEditApplied passes.
        const actual = modelFromSSL(await parseDialog(out));
        expect(actual.roots[0]!.states.find((s) => s.id === "Node002")!.bundleFaithful).toBe(true);
        expect(verifySSLEditApplied(edited, actual)).toEqual({ ok: true });
    });
});

describe("bundleNodeOps + branchConditionOps - span-identity matching (Task 7)", () => {
    // Two sibling if branches: the first has no opaque (removable via branchStructureOps) and
    // the second carries set_local_var (making the node bundleFaithful; not removable). A save
    // that removes the first branch AND edits the surviving second branch's condition must not
    // mis-splice the new condition onto the removed branch's old conditionRange.
    const SRC_T7B = `procedure Node002 begin
    if (global_var(GVAR_A) == 1) then begin
        NOption(101, Node915, 4);
    end
    if (global_var(GVAR_B) == 1) then begin
        set_local_var(LVAR_0, 1);
        NOption(102, Node999, 4);
    end
end
procedure Node915 begin Reply(900); end
procedure Node999 begin Reply(999); end
procedure talk_p_proc begin call Node002; end
`;

    it("removes the first branch and edits the surviving branch's condition without mis-splice", async () => {
        const original = modelFromSSL(await parseDialog(SRC_T7B));
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        expect(node.bundleFaithful).toBe(true); // fixture sanity check

        // Remove the first branch (GVAR_A, no opaque -> branchStructureOps can delete it).
        const removedBranch = node.branches!.find((b) => b.kind === "if" && b.condition?.includes("GVAR_A"))!;
        const removedIds = new Set(removedBranch.choiceIds);
        node.branches = node.branches!.filter((b) => b !== removedBranch);
        node.choices = node.choices.filter((c) => !removedIds.has(c.id));

        // Edit the surviving second branch's condition AND the corresponding choice conditions,
        // mirroring the real editor's ops (applyBranchConditionEdit updates both).
        const survivingBranch = node.branches!.find((b) => b.kind === "if" && b.condition?.includes("GVAR_B"))!;
        survivingBranch.condition = "(global_var(GVAR_B) == 5)";
        for (const id of survivingBranch.choiceIds) {
            const ch = node.choices.find((c) => c.id === id);
            if (ch) ch.condition = "(global_var(GVAR_B) == 5)";
        }

        const out = applySSLDialogEdits(SRC_T7B, edited, original);

        // The first branch must be gone.
        expect(out).not.toContain("global_var(GVAR_A)");
        expect(out).not.toContain("NOption(101");

        // The surviving branch's condition must be the NEW value, landed on ITS OWN span.
        expect(out).toContain("global_var(GVAR_B) == 5");
        expect(out).not.toContain("global_var(GVAR_B) == 1");

        // The surviving branch's option and side-effect must be intact.
        expect(out).toContain("NOption(102, Node999, 4)");
        expect(out).toContain("set_local_var(LVAR_0, 1)");

        // Round-trip: re-parse and verify both the condition edit and absence of the removed branch.
        const actual = modelFromSSL(await parseDialog(out));
        expect(verifySSLEditApplied(edited, actual)).toEqual({ ok: true });
    });
});
