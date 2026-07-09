import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTSSLSource } from "../src/tssl/dialog-source";
import { modelFromSSL, type DialogModel } from "../../shared/dialog-model";
import { applyTSSLDialogEdits } from "../../shared/dialog-tssl-edit";
import * as ops from "../../shared/dialog-edit-ops";

const flat = readFileSync(fileURLToPath(new URL("tssl/samples/flat.tssl", import.meta.url)), "utf8");
const multi = readFileSync(fileURLToPath(new URL("tssl/samples/multi.tssl", import.meta.url)), "utf8");

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

    it("flips a surviving option's reaction Neutral -> Good (NOption -> GOption), rest byte-identical", () => {
        const original = tsslModel(flat);
        const edited = structuredClone(original);
        const opt = edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices.find(
            (c) => c.target.kind === "state",
        )!;
        opt.reaction = "good";
        const out = applyTSSLDialogEdits(flat, edited, original);
        // Only the macro-name token changes; the msg-id/target/skill args are byte-exact.
        expect(out).toBe(flat.replace("NOption(101, Node002, 4)", "GOption(101, Node002, 4)"));
    });

    it("toggles a surviving option's low-INT variant (NOption -> NLowOption), dropping the skill arg", () => {
        const original = tsslModel(flat);
        const edited = structuredClone(original);
        const opt = edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices.find(
            (c) => c.target.kind === "state",
        )!;
        opt.lowIq = true;
        const out = applyTSSLDialogEdits(flat, edited, original);
        // The Low/non-Low forms differ in arg count (3-arg -> 2-arg), so the whole call is re-serialized; the
        // original numeric id text is preserved.
        expect(out).toBe(flat.replace("NOption(101, Node002, 4)", "NLowOption(101, Node002)"));
    });

    it("reorders a node's options: moving option #2 above #1 swaps their source statements", () => {
        const original = { ...modelFromSSL(parseTSSLSource(multi)), sourceLang: "tssl" as const, editable: true };
        const edited = structuredClone(original);
        const node1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        // Source order: [-> Node002, -> Node003]. Swap so Node003's option comes first.
        node1.choices = [node1.choices[1]!, node1.choices[0]!];
        const out = applyTSSLDialogEdits(multi, edited, original);
        // The two option statements are swapped in source; everything else byte-identical.
        expect(out.indexOf("NOption(102, Node003, 4)")).toBeLessThan(out.indexOf("NOption(101, Node002, 4)"));
        expect(out).toBe(
            multi.replace(
                "    NOption(101, Node002, 4);\n    NOption(102, Node003, 4);",
                "    NOption(102, Node003, 4);\n    NOption(101, Node002, 4);",
            ),
        );
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

    it("adds a new node: serializes a function before talk_p_proc and retargets the inbound option to it", () => {
        const original = tsslModel(flat);
        const edited = structuredClone(original);
        const root = edited.roots[0]!;
        // A brand-new node (no procRange) with a reply and one terminal option, both already @N-allocated.
        root.states.push({
            id: "Node003",
            text: "@300",
            choices: [{ id: "Node003#o0", text: "@301", target: { kind: "exit" } }],
        } as (typeof root.states)[number]);
        // Wire it in: retarget Node001's existing option from Node002 to the new node.
        const opt = root.states.find((s) => s.id === "Node001")!.choices.find((c) => c.target.kind === "state")!;
        (opt.target as { kind: "state"; stateId: string }).stateId = "Node003";
        const out = applyTSSLDialogEdits(flat, edited, original);
        // The new function is serialized before the entry router, with its Reply and terminal option.
        expect(out).toContain("function Node003() {");
        expect(out).toMatch(/function Node003\(\) \{\n {4}Reply\(300\);\n {4}NMessage\(301\);\n\}/);
        expect(out.indexOf("function Node003()")).toBeLessThan(out.indexOf("function talk_p_proc"));
        // The inbound option is retargeted to it; Node002's own function is untouched (it was not deleted).
        expect(out).toContain("NOption(101, Node003, 4);");
        expect(out).not.toContain("NOption(101, Node002");
        expect(out).toContain("function Node002()");
    });

    it("renames a node: rewrites the function name and the talk_p_proc entry call", () => {
        const original = tsslModel(flat);
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        // What ops.renameState records: renamedFrom = old id, id = new id (no inbound options for Node001).
        node.renamedFrom = "Node001";
        node.id = "Node009";
        const out = applyTSSLDialogEdits(flat, edited, original);
        expect(out).toContain("function Node009()"); // definition renamed
        expect(out).not.toContain("function Node001()");
        // The entry call inside talk_p_proc is renamed (assert on the router body, not the header comment
        // which legitimately still mentions Node001 as documentation).
        const router = out.slice(out.indexOf("function talk_p_proc()"));
        expect(router).toContain("Node009();");
        expect(router).not.toMatch(/\bNode001\b/);
        expect(out).toContain("function Node002()"); // an unrelated node is untouched
    });

    it("renames a node targeted by an option: the inbound option retargets to the new id", () => {
        const original = tsslModel(flat);
        const edited = structuredClone(original);
        const node = edited.roots[0]!.states.find((s) => s.id === "Node002")!;
        node.renamedFrom = "Node002";
        node.id = "Node009";
        // ops.renameState also moves inbound option targets old id -> new id.
        const opt = edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices.find(
            (c) => c.target.kind === "state",
        )!;
        (opt.target as { kind: "state"; stateId: string }).stateId = "Node009";
        const out = applyTSSLDialogEdits(flat, edited, original);
        expect(out).toContain("function Node009()");
        expect(out).toContain("NOption(101, Node009, 4);"); // inbound option retargeted
        expect(out).not.toMatch(/\bNode002\b/);
    });

    it("deletes an entry node: removes its function and its talk_p_proc entry call", () => {
        const original = tsslModel(flat);
        const edited = structuredClone(original);
        const root = edited.roots[0]!;
        root.states = root.states.filter((s) => s.id !== "Node001"); // Node001 is the sole talk_p_proc entry
        const out = applyTSSLDialogEdits(flat, edited, original);
        expect(out).not.toContain("function Node001()"); // the procedure is gone
        const router = out.slice(out.indexOf("function talk_p_proc()"));
        expect(router).not.toMatch(/\bNode001\b/); // ...and its entry call, no dangling reference
    });

    it("rejects a non-tssl model (each writer serializes only its own source syntax)", () => {
        const d = { ...tsslModel(flat), sourceLang: "d" as const };
        expect(() => applyTSSLDialogEdits(flat, d, tsslModel(flat))).toThrow(/only tssl/);
    });
});

describe("applyTSSLDialogEdits - bundle branch editing (SSL parity)", () => {
    // Body is only if/else (no top-level flat call), each branch carrying its NPC line + options, plus a
    // preservable side-effect statement. Classifies as bundleFaithful -> editable, per the source parser.
    const SRC = `function Node002() {
    if (local_var(LVAR_0) == 0) {
        set_local_var(LVAR_0, 1);
        Reply(120);
        NOption(122, Node915, 4);
        NOption(123, Node999, 4);
    } else {
        Reply(121);
        NOption(124, Node915, 4);
    }
}

function Node915() { Reply(900); }

function Node999() { Reply(999); }

function talk_p_proc() { Node002(); }
`;
    const model = () => ({ ...modelFromSSL(parseTSSLSource(SRC)), sourceLang: "tssl" as const, editable: true });
    const node = (m: DialogModel) => m.roots[0]!.states.find((s) => s.id === "Node002")!;

    it("edits an if-branch condition in place, leaving else/options/side-effect byte-exact", () => {
        const original = model();
        const edited = structuredClone(original);
        node(edited).branches!.find((b) => b.kind === "if")!.condition = "local_var(LVAR_0) == 2";
        const out = applyTSSLDialogEdits(SRC, edited, original);
        expect(out).toContain("if (local_var(LVAR_0) == 2)");
        expect(out).not.toContain("== 0)");
        expect(out).toContain("set_local_var(LVAR_0, 1);"); // side-effect intact
        expect(out).toContain("NOption(122, Node915, 4)"); // options intact
        expect(out).toContain("} else {"); // skeleton intact
    });

    it("retargets an else-branch option in place, then-branch + side-effect byte-exact", () => {
        const original = model();
        const edited = structuredClone(original);
        const elseB = node(edited).branches!.find((b) => b.kind === "else")!;
        const opt = node(edited).choices.find((c) => elseB.choiceIds.includes(c.id))!;
        (opt.target as { kind: "state"; stateId: string }).stateId = "Node999";
        const out = applyTSSLDialogEdits(SRC, edited, original);
        expect(out).toContain("NOption(124, Node999, 4)"); // else option retargeted
        expect(out).toContain("NOption(122, Node915, 4)"); // then-branch untouched
        expect(out).toContain("set_local_var(LVAR_0, 1);");
    });

    it("removes one option from the then-branch, leaving the rest byte-exact", () => {
        const original = model();
        const edited = structuredClone(original);
        const n = node(edited);
        const ifB = n.branches!.find((b) => b.kind === "if")!;
        const tgt = n.choices.find(
            (c) => ifB.choiceIds.includes(c.id) && c.target.kind === "state" && c.target.stateId === "Node999",
        )!;
        n.choices = n.choices.filter((c) => c.id !== tgt.id);
        ifB.choiceIds = ifB.choiceIds.filter((id) => id !== tgt.id);
        const out = applyTSSLDialogEdits(SRC, edited, original);
        expect(out).not.toContain("NOption(123, Node999, 4)"); // removed
        expect(out).toContain("NOption(122, Node915, 4)"); // kept (then)
        expect(out).toContain("NOption(124, Node915, 4)"); // kept (else)
        expect(out).toContain("set_local_var(LVAR_0, 1);");
    });

    it("removes the else branch, collapsing `} else { ... }` to `}`", () => {
        const original = model();
        const edited = structuredClone(original);
        const n = node(edited);
        const elseIdx = n.branches!.findIndex((b) => b.kind === "else");
        const elseB = n.branches![elseIdx]!;
        n.choices = n.choices.filter((c) => !elseB.choiceIds.includes(c.id));
        n.branches!.splice(elseIdx, 1);
        const out = applyTSSLDialogEdits(SRC, edited, original);
        expect(out).not.toContain("else"); // the whole else clause is gone
        expect(out).not.toContain("NOption(124"); // its option gone with it
        expect(out).toContain("NOption(122, Node915, 4)"); // then-branch intact
    });

    it("adds a new if-branch, serialized in TS `if (cond) { ... }` syntax", () => {
        const original = model();
        const edited = structuredClone(original);
        ops.addBranch(node(edited), "global_var(GVAR_NEW) == 1");
        const out = applyTSSLDialogEdits(SRC, edited, original);
        expect(out).toContain("if (global_var(GVAR_NEW) == 1) {");
        // The new branch uses TS braces, never the SSL `then begin`/`end` form.
        expect(out).not.toContain("then begin");
    });
});

describe("applyTSSLDialogEdits - conditional-option removal (shared nodeOps engine)", () => {
    // Mirror of the SSL conditional-removal shape in TS syntax: a flat option plus a PURE single-`if` conditional
    // option in one faithful (non-bundle) node - the path now routed through the shared nodeOps engine.
    const SRC_COND_RM = `function Node001() {
    NOption(101, Node002, 4);
    if (local_var(LVAR_x) == 0) {
        NOption(102, Node003, 4);
    }
}
function Node002() { Reply(200); }
function Node003() { Reply(300); }
function talk_p_proc() { Node001(); }
`;

    it("removes a pure-conditional option by splicing out its enclosing if", () => {
        const original = tsslModel(SRC_COND_RM);
        const edited = structuredClone(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        n1.choices = n1.choices.filter((c) => c.condition === undefined); // drop the conditional option (102)
        const out = applyTSSLDialogEdits(SRC_COND_RM, edited, original);
        expect(out).not.toContain("NOption(102"); // the conditional option is gone
        expect(out).not.toContain("local_var(LVAR_x)"); // its enclosing `if` went with it
        expect(out).toContain("NOption(101, Node002, 4);"); // the flat sibling survives
        const reparsed = tsslModel(out);
        const n1r = reparsed.roots[0]!.states.find((s) => s.id === "Node001")!;
        expect(n1r.choices).toHaveLength(1);
    });

    // Parity with the SSL shared-block removal cases: a flat option plus a SHARED `if` gating TWO options
    // (multi-call block -> impure -> conditionEditable=false), in TS syntax through the same shared nodeOps engine.
    const SRC_SHARED_RM = `function Node001() {
    NOption(101, Node002, 4);
    if (local_var(LVAR_x) == 0) {
        NOption(102, Node003, 4);
        NOption(103, Node004, 4);
    }
}
function Node002() { Reply(200); }
function Node003() { Reply(300); }
function Node004() { Reply(400); }
function talk_p_proc() { Node001(); }
`;

    it("the shared-block fixture parses to a faithful node whose if-gated options are condition-read-only (guard)", () => {
        const m = tsslModel(SRC_SHARED_RM);
        const n1 = m.roots[0]!.states.find((s) => s.id === "Node001")!;
        expect(n1.faithful).toBe(true);
        expect(n1.bundleFaithful ?? false).toBe(false);
        expect(n1.choices).toHaveLength(3);
        const [flatOpt, o102, o103] = n1.choices;
        expect(flatOpt!.condition ?? "").toBe("");
        expect(o102!.condition).toContain("local_var(LVAR_x)");
        expect(o102!.conditionEditable).toBe(false);
        expect(o103!.conditionEditable).toBe(false);
        expect(o102!.ifRange).toEqual(o103!.ifRange); // one shared `if`
        expect(o102!.stmtRange).not.toEqual(o103!.stmtRange); // distinct calls
    });

    it("removing one option from a shared `if` block keeps the `if`, the sibling, and the flat option", () => {
        const original = tsslModel(SRC_SHARED_RM);
        const edited = structuredClone(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        n1.choices = n1.choices.filter((c) => !(c.target.kind === "state" && c.target.stateId === "Node003"));
        const out = applyTSSLDialogEdits(SRC_SHARED_RM, edited, original);
        expect(out).not.toContain("NOption(102");
        expect(out).toContain("if (local_var(LVAR_x) == 0)"); // shared `if` survives
        expect(out).toContain("NOption(103, Node004, 4);"); // sibling survives
        expect(out).toContain("NOption(101, Node002, 4);"); // flat option survives
        const n1r = tsslModel(out).roots[0]!.states.find((s) => s.id === "Node001")!;
        expect(n1r.choices).toHaveLength(2);
    });

    it("removing ALL options from a shared `if` block leaves no dead empty gate", () => {
        const original = tsslModel(SRC_SHARED_RM);
        const edited = structuredClone(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        n1.choices = n1.choices.filter((c) => c.condition === undefined); // keep only the flat option
        const out = applyTSSLDialogEdits(SRC_SHARED_RM, edited, original);
        expect(out).toContain("NOption(101, Node002, 4);");
        expect(out).not.toContain("NOption(102");
        expect(out).not.toContain("NOption(103");
        expect(out).not.toContain("local_var(LVAR_x)"); // the whole `if` is gone, not left as an empty `if () {}`
        expect(out).not.toMatch(/\bif\b[^{]*\{\s*\}/); // no dead empty `if (...) { }` gate
        const n1r = tsslModel(out).roots[0]!.states.find((s) => s.id === "Node001")!;
        expect(n1r.choices).toHaveLength(1);
    });
});

describe("applyTSSLDialogEdits - conditional-option ADD / wrap (parity with SSL)", () => {
    // SSL wraps a flat option in an `if (...) then begin ... end` when a condition is added (Tier 3c). TSSL exposes
    // the same editable condition field (a flat faithful option is conditionEditable), and its edit-text and
    // remove/unwrap paths already work - only the ADD/wrap path was unwired, so a typed condition was silently
    // dropped on save (the writer returned the source unchanged). This asserts TSSL now wraps at parity with SSL,
    // in TS-brace syntax.
    const SRC = `function Node001() {
    NOption(101, Node002, 4);
}
function Node002() { Reply(200); }
function talk_p_proc() { Node001(); }
`;

    it("wraps a flat option in a TS-brace `if (...) { }` when a condition is added", () => {
        const original = tsslModel(SRC);
        const edited = structuredClone(original);
        const opt = edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!;
        opt.condition = "local_var(LVAR_x) == 0";
        const out = applyTSSLDialogEdits(SRC, edited, original);
        expect(out).toContain("if (local_var(LVAR_x) == 0) {"); // gated in TS syntax
        expect(out).toContain("NOption(101, Node002, 4);"); // the option itself is preserved
        expect(out).not.toContain("then begin"); // never the SSL block form
        // Round-trips: the reparsed option is now conditionally gated.
        const n1r = tsslModel(out).roots[0]!.states.find((s) => s.id === "Node001")!;
        expect(n1r.choices[0]!.condition).toContain("local_var(LVAR_x)");
    });
});
