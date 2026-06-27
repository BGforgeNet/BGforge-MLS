import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";
import { modelFromSSL, type DialogModel } from "../../shared/dialog-model";
import { applySSLDialogEdits, verifySSLEditApplied } from "../../shared/dialog-ssl-edit";

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
});
