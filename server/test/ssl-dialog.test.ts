import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";

// parseDialog self-initializes the SSL tree-sitter parser on first call.
describe("parseDialog (SSL) honesty fixes", () => {
    it("flags a conditional Reply and a conditional NOption with the condition text", async () => {
        const ssl = `
procedure Node001 begin
    if (global_var(GVAR_X) == 1) then begin
        Reply(100);
        NOption(101, Node002, 4);
    end
end
procedure Node002 begin
    Reply(200);
    NMessage(201);
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const result = await parseDialog(ssl);
        const n1 = result.nodes.find((n) => n.name === "Node001")!;
        expect(n1.replies[0]!.conditional).toContain("GVAR_X");
        expect(n1.options[0]!.conditional).toContain("GVAR_X");
        // An unconditional reply stays unconditional.
        const n2 = result.nodes.find((n) => n.name === "Node002")!;
        expect(n2.replies[0]!.conditional).toBeUndefined();
    });

    it("negates the if-condition for an option in the else branch", async () => {
        const ssl = `
procedure Node001 begin
    if (global_var(GVAR_X) == 1) then begin
        NOption(100, Node002, 4);
    end else begin
        NOption(101, Node003, 4);
    end
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const result = await parseDialog(ssl);
        const n1 = result.nodes.find((n) => n.name === "Node001")!;
        const ifOpt = n1.options.find((o) => o.target === "Node002")!;
        const elseOpt = n1.options.find((o) => o.target === "Node003")!;
        // The if-branch option keeps the condition; the else-branch option runs on its negation.
        expect(ifOpt.conditional).toBe("(global_var(GVAR_X) == 1)");
        expect(elseOpt.conditional).toBe("!(global_var(GVAR_X) == 1)");
    });

    it("keeps non-Node call targets (e.g. combat)", async () => {
        const ssl = `
procedure Node001 begin
    Reply(100);
    call combat;
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const result = await parseDialog(ssl);
        const n1 = result.nodes.find((n) => n.name === "Node001")!;
        expect(n1.callTargets).toContain("combat");
    });

    it("includes a side-effect-only node that is an option target (no dangling edge)", async () => {
        const ssl = `
procedure Node001 begin
    Reply(100);
    NOption(101, Node002, 4);
end
procedure Node002 begin
    set_global_var(GVAR_DONE, 1);
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const result = await parseDialog(ssl);
        expect(result.nodes.find((n) => n.name === "Node002")).toBeDefined();
    });

    it("detects force_dialog_start entry points outside talk_p_proc", async () => {
        const ssl = `
procedure Node050 begin
    Reply(100);
    NMessage(101);
end
procedure map_enter_p_proc begin
    force_dialog_start(Node050);
end
procedure talk_p_proc begin
end
`;
        const result = await parseDialog(ssl);
        expect(result.entryPoints).toContain("Node050");
    });
});

// The dialog graph is rooted at the conversation entries (talk_p_proc + force_dialog_start),
// not at every procedure that happens to contain a Reply/option. Lifecycle handlers like
// pickup_p_proc are SSL script procs, not dialog nodes, and must not appear in the graph.
describe("parseDialog (SSL) node scope", () => {
    it("excludes a procedure not reachable from a dialog entry (pickup_p_proc)", async () => {
        const ssl = `
procedure Node001 begin
    Reply(100);
    NOption(101, Node002, 4);
end
procedure Node002 begin
    Reply(200);
    NMessage(201);
end
procedure pickup_p_proc begin
    Reply(900);
    NMessage(901);
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const result = await parseDialog(ssl);
        const names = result.nodes.map((n) => n.name).sort();
        expect(names).toEqual(["Node001", "Node002"]);
    });

    it("keeps a force_dialog_start entry and its reachable nodes", async () => {
        const ssl = `
procedure Node050 begin
    Reply(100);
    NOption(101, Node051, 4);
end
procedure Node051 begin
    NMessage(102);
end
procedure pickup_p_proc begin
    Reply(900);
end
procedure map_enter_p_proc begin
    force_dialog_start(Node050);
end
procedure talk_p_proc begin
end
`;
        const result = await parseDialog(ssl);
        const names = result.nodes.map((n) => n.name).sort();
        expect(names).toEqual(["Node050", "Node051"]);
    });

    it("includes an unreachable, non-hook dialog node (a just-added or duplicated orphan)", async () => {
        const ssl = `
procedure Node001 begin
    Reply(100);
end
procedure Node050 begin
    Reply(500);
    NMessage(501);
end
procedure pickup_p_proc begin
    Reply(900);
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const result = await parseDialog(ssl);
        // Node050 is unreachable (no inbound ref yet) but is a real dialog node - it has dialog calls and is
        // not a *_p_proc engine hook - so it stays visible for the user to wire (a just-created or duplicated
        // node must not vanish). pickup_p_proc (a hook, despite its Reply) is still excluded.
        expect(result.nodes.map((n) => n.name).sort()).toEqual(["Node001", "Node050"]);
    });
});

// The side-effect honesty badge needs to know which builtins a node runs beyond showing
// its line. The parser does not own the policy of WHICH functions count (that is the
// void-return classification, derived from static data and injected); it just records the
// node's calls that fall in the supplied set. Display/debug filtering happens upstream when
// the set is built, so the set passed here is already the mutating-only set.
describe("parseDialog (SSL) side-effect detection", () => {
    const SIDE_EFFECT_FNS = new Set(["set_global_var", "give_xp", "set_local_var"]);

    it("records, in source order, the side-effect builtins a node calls", async () => {
        const ssl = `
procedure Node001 begin
    Reply(100);
    set_global_var(GVAR_DONE, 1);
    give_xp(500);
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const result = await parseDialog(ssl, SIDE_EFFECT_FNS);
        const n1 = result.nodes.find((n) => n.name === "Node001")!;
        expect(n1.sideEffects).toEqual(["set_global_var", "give_xp"]);
    });

    it("ignores calls absent from the set: reads, dialog macros, and nested call args", async () => {
        const ssl = `
procedure Node001 begin
    if (global_var(GVAR_X) == 1) then Reply(metarule(5, 0));
    NOption(101, Node002, 4);
end
procedure Node002 begin
    Reply(200);
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const result = await parseDialog(ssl, SIDE_EFFECT_FNS);
        const n1 = result.nodes.find((n) => n.name === "Node001")!;
        expect(n1.sideEffects ?? []).toEqual([]);
    });

    it("deduplicates a builtin called more than once in the same node", async () => {
        const ssl = `
procedure Node001 begin
    Reply(100);
    set_global_var(GVAR_A, 1);
    set_global_var(GVAR_B, 2);
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const result = await parseDialog(ssl, SIDE_EFFECT_FNS);
        const n1 = result.nodes.find((n) => n.name === "Node001")!;
        expect(n1.sideEffects).toEqual(["set_global_var"]);
    });

    it("records nothing when no side-effect set is supplied (back-compat default)", async () => {
        const ssl = `
procedure Node001 begin
    Reply(100);
    set_global_var(GVAR_DONE, 1);
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const result = await parseDialog(ssl);
        const n1 = result.nodes.find((n) => n.name === "Node001")!;
        expect(n1.sideEffects ?? []).toEqual([]);
    });
});

describe("Tier 3c: condition spans", () => {
    const src = `procedure talk_p_proc begin
    call Node001;
end

procedure Node001 begin
    Reply(100);
    NOption(101, Node002, 004);
    if (local_var(LVAR_x) == 0) then
        NOption(102, Node003, 004);
    if (global_var(GVAR_y) == 1) then begin
        Reply(103);
        NOption(104, Node004, 004);
    end
end`;

    it("captures condRange/ifRange/ifSingleCall for a single-statement if", async () => {
        const data = await parseDialog(src);
        const n1 = data.nodes.find((n) => n.name === "Node001")!;
        const cond = n1.options.find((o) => o.msgId === 102)!;
        expect(cond.condRange).toBeDefined();
        expect(src.slice(cond.condRange!.start, cond.condRange!.end)).toBe("(local_var(LVAR_x) == 0)");
        expect(src.slice(cond.ifRange!.start, cond.ifRange!.end)).toMatch(
            /^if \(local_var\(LVAR_x\) == 0\) then[\s\S]*NOption\(102, Node003, 004\);$/,
        );
        expect(cond.ifSingleCall).toBe(true);
    });

    it("marks a multi-call (shared) faithful block ifSingleCall=false", async () => {
        const data = await parseDialog(src);
        const n1 = data.nodes.find((n) => n.name === "Node001")!;
        const shared = n1.options.find((o) => o.msgId === 104)!;
        expect(shared.condRange).toBeDefined();
        expect(shared.ifSingleCall).toBe(false);
    });

    it("leaves unconditional options without condition spans", async () => {
        const data = await parseDialog(src);
        const n1 = data.nodes.find((n) => n.name === "Node001")!;
        const flat = n1.options.find((o) => o.msgId === 101)!;
        expect(flat.condRange).toBeUndefined();
        expect(flat.ifRange).toBeUndefined();
        expect(flat.ifSingleCall).toBeUndefined();
    });
});

describe("bundle branch grouping", () => {
    const SRC = `procedure Node002 begin
    if (local_var(LVAR_0) == 0) then begin
        set_local_var(LVAR_0,1);
        Reply(120);
        NOption(122, Node915, 4);
        NOption(123, Node999, 4);
    end
    else begin
        Reply(121);
        NOption(124, Node915, 4);
        NOption(125, Node999, 4);
    end
end
procedure talk_p_proc begin call Node002; end
`;
    it("groups replies/options into if and else branches with the condition and opaque side-effects", async () => {
        const data = await parseDialog(SRC);
        const n = data.nodes.find((x) => x.name === "Node002")!;
        expect(n.branches).toBeDefined();
        const [ifB, elseB] = n.branches!;
        expect(ifB!.kind).toBe("if");
        expect(ifB!.condition).toBe("(local_var(LVAR_0) == 0)");
        expect(ifB!.replyIndices.map((i) => n.replies[i]!.msgId)).toEqual([120]);
        expect(ifB!.optionIndices.map((i) => n.options[i]!.msgId)).toEqual([122, 123]);
        expect(ifB!.opaque).toHaveLength(1);
        expect(SRC.slice(ifB!.opaque[0]!.textRange.start, ifB!.opaque[0]!.textRange.end)).toBe(
            "set_local_var(LVAR_0,1);",
        );
        expect(ifB!.opaque[0]!.text).toBe("set_local_var(LVAR_0,1);");
        expect(elseB!.kind).toBe("else");
        expect(elseB!.condition).toBeUndefined();
        expect(elseB!.optionIndices.map((i) => n.options[i]!.msgId)).toEqual([124, 125]);
        expect(elseB!.opaque).toHaveLength(0);
    });
    it("does not attach branches to a plain faithful node", async () => {
        const data = await parseDialog(
            `procedure Node001 begin Reply(1); NOption(2, Node002, 4); end\nprocedure talk_p_proc begin call Node001; end\n`,
        );
        expect(data.nodes.find((n) => n.name === "Node001")!.branches).toBeUndefined();
    });
    it("captures each if-branch condition span (conditionRange), none for else", async () => {
        const data = await parseDialog(SRC);
        const n = data.nodes.find((x) => x.name === "Node002")!;
        const [ifB, elseB] = n.branches!;
        expect(ifB!.conditionRange).toBeDefined();
        expect(SRC.slice(ifB!.conditionRange!.start, ifB!.conditionRange!.end)).toBe("(local_var(LVAR_0) == 0)");
        expect(ifB!.conditionRange).toEqual({ start: expect.any(Number), end: expect.any(Number) });
        expect(elseB!.conditionRange).toBeUndefined();
    });
    it("captures a per-branch insert anchor at the end of each branch body", async () => {
        const data = await parseDialog(SRC);
        const n = data.nodes.find((x) => x.name === "Node002")!;
        const [ifB, elseB] = n.branches!;
        // The if-branch's last body statement is NOption(123, Node999, 4); the anchor offset is its end,
        // which must sit before the branch's closing `end`.
        expect(ifB!.insertAnchor).toBeDefined();
        expect(ifB!.insertAnchor!.indent).toMatch(/^\s+$/);
        const afterAnchor = SRC.slice(ifB!.insertAnchor!.offset);
        expect(afterAnchor.trimStart().startsWith("end")).toBe(true); // anchor is just before the branch `end`
        expect(elseB!.insertAnchor).toBeDefined();
    });
});
