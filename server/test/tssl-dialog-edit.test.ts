import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTSSLSource } from "../src/tssl/dialog-source";
import { modelFromSSL, type DialogModel } from "../../shared/dialog-model";
import { applyTSSLDialogEdits } from "../../shared/dialog-tssl-edit";

const flat = readFileSync(fileURLToPath(new URL("tssl/samples/flat.tssl", import.meta.url)), "utf8");

function tsslModel(src: string): DialogModel {
    return { ...modelFromSSL(parseTSSLSource(src)), sourceLang: "tssl", editable: true };
}

describe("applyTSSLDialogEdits - option retarget", () => {
    it("splices an option's new target into the .tssl source, rest byte-identical", () => {
        const original = tsslModel(flat);
        const edited = structuredClone(original);
        const opt = edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices.find(
            (c) => c.target.kind === "state",
        )!;
        (opt.target as { kind: "state"; stateId: string }).stateId = "Node001";
        const out = applyTSSLDialogEdits(flat, edited, original);
        expect(out).toContain("NOption(101, Node001, 4)");
        expect(out).not.toContain("Node002, 4"); // the old target token is gone from that call
        // Everything outside the retargeted token is byte-identical.
        expect(out).toBe(flat.replace("NOption(101, Node002, 4)", "NOption(101, Node001, 4)"));
    });

    it("returns the source unchanged when no target changed", () => {
        const original = tsslModel(flat);
        expect(applyTSSLDialogEdits(flat, structuredClone(original), original)).toBe(flat);
    });

    it("splices an edited option condition into the .tssl if-wrapper", () => {
        const conditional = readFileSync(
            fileURLToPath(new URL("tssl/samples/conditional.tssl", import.meta.url)),
            "utf8",
        );
        const original = { ...modelFromSSL(parseTSSLSource(conditional)), sourceLang: "tssl" as const, editable: true };
        const edited = structuredClone(original);
        const opt = edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices.find(
            (c) => c.condition !== undefined,
        )!;
        opt.condition = "global_var(GVAR_Y) == 2";
        const out = applyTSSLDialogEdits(conditional, edited, original);
        expect(out).toContain("if (global_var(GVAR_Y) == 2)");
        expect(out).not.toContain("GVAR_X");
    });

    it("removes an option by splicing its statement out (reply stays)", () => {
        const original = tsslModel(flat);
        const edited = structuredClone(original);
        const node1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        node1.choices = node1.choices.filter((c) => c.target.kind !== "state"); // drop the NOption -> Node002
        const out = applyTSSLDialogEdits(flat, edited, original);
        expect(out).not.toContain("NOption(101");
        expect(out).toContain("Reply(100)");
        expect(out).toContain("function Node001()"); // node wrapper intact, no blank line left
    });

    it("adds a new option by serializing NOption after the last surviving option", () => {
        const original = tsslModel(flat);
        const edited = structuredClone(original);
        const node1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        // A pending-new option (no callRange/stmtRange, already-allocated @N) targeting Node002.
        node1.choices.push({
            id: "Node001#new0",
            text: "@500",
            target: { kind: "state", stateId: "Node002" },
            skill: 4,
        });
        const out = applyTSSLDialogEdits(flat, edited, original);
        // The existing option stays and the new one is serialized right after it, inside the same function.
        expect(out).toContain("NOption(101, Node002, 4);");
        expect(out).toContain("NOption(500, Node002, 4);");
        expect(out.indexOf("NOption(500")).toBeGreaterThan(out.indexOf("NOption(101"));
        // The new call lands before Node001's closing brace (still inside the function body), at the body indent.
        const node1Body = out.slice(out.indexOf("function Node001()"), out.indexOf("function Node002()"));
        expect(node1Body).toMatch(/\n {4}NOption\(500, Node002, 4\);/);
        // Node002 is untouched (byte-identical outside Node001's body).
        expect(out.slice(out.indexOf("function Node002()"))).toBe(flat.slice(flat.indexOf("function Node002()")));
    });

    it("deletes a node: splices out its function and flips the inbound option to a terminal NMessage", () => {
        const original = tsslModel(flat);
        const edited = structuredClone(original);
        const root = edited.roots[0]!;
        // What ops.deleteState does: redirect same-dialogue inbound targets to exit, drop the state.
        for (const s of root.states) {
            for (const c of s.choices) {
                if (c.target.kind === "state" && c.target.stateId === "Node002") c.target = { kind: "exit" };
            }
        }
        root.states = root.states.filter((s) => s.id !== "Node002");
        const out = applyTSSLDialogEdits(flat, edited, original);
        expect(out).not.toContain("function Node002()"); // the whole procedure is gone
        expect(out).not.toContain("NMessage(201)"); // ...along with its own body
        expect(out).toContain("NMessage(101);"); // the inbound option flipped state -> terminal
        expect(out).not.toContain("NOption(101"); // no longer an option targeting the deleted node
        expect(out).toContain("function Node001()"); // the surviving node stays
        expect(out).toContain("Node001();"); // talk_p_proc entry untouched
    });

    it("rejects a non-tssl model (each writer serializes only its own source syntax)", () => {
        const d = { ...tsslModel(flat), sourceLang: "d" as const };
        expect(() => applyTSSLDialogEdits(flat, d, tsslModel(flat))).toThrow(/only tssl/);
    });
});
