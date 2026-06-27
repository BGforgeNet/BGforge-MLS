import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";
import { modelFromSSL, type DialogModel } from "../../shared/dialog-model";
import { applySSLDialogEdits, eligibleToDelete, verifySSLEditApplied } from "../../shared/dialog-ssl-edit";

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
    it("allows deleting a node referenced only by options, refuses one reached by a call or entry", async () => {
        const src = `procedure Node001 begin\n    NOption(101, Node002, 4);\n    call Node003;\nend\nprocedure Node002 begin Reply(200); end\nprocedure Node003 begin Reply(300); end\nprocedure talk_p_proc begin call Node001; end\n`;
        const model = modelFromSSL(await parseDialog(src));
        expect(eligibleToDelete(model, "Node002")).toBe(true); // only an option points at it
        expect(eligibleToDelete(model, "Node003")).toBe(false); // reached by `call Node003`
        expect(eligibleToDelete(model, "Node001")).toBe(false); // talk_p_proc entry (call Node001)
    });

    it("refuses a node whose inbound option lives in a non-faithful node (its reference cannot be rewritten)", async () => {
        // Node001 has a while loop -> non-faithful, so its NOption(101, Node002) is never rewritten by the
        // splicer. Deleting Node002 would leave a dangling reference, so delete must be refused.
        const src = `procedure Node001 begin\n    while (local_var(0)) do begin end\n    NOption(101, Node002, 4);\nend\nprocedure Node002 begin Reply(200); end\nprocedure talk_p_proc begin call Node001; end\n`;
        const model = modelFromSSL(await parseDialog(src));
        expect(model.roots[0]!.states.find((s) => s.id === "Node001")!.faithful).toBe(false);
        expect(eligibleToDelete(model, "Node002")).toBe(false);
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
