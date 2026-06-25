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
