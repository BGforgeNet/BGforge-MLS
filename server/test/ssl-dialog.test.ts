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
