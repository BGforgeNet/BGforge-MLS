/**
 * Unit tests for tssl/dialog.ts - TSSL dialog parser for tree visualization.
 * Mocks the TSSL transpiler and tests that parseTSSLDialog correctly
 * routes transpiled SSL through the existing SSL dialog parser.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

// Mock lsp-connection to avoid LSP connection issues in tests
vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    }),
}));

// Mock the TSSL transpiler — it requires esbuild, ts-morph, and file I/O.
// We return pre-built SSL text so the test focuses on the dialog parsing pipeline.
vi.mock("../../transpilers/tssl/src/index", () => ({
    transpile: vi.fn(),
}));

import { parseTSSLDialog } from "../src/tssl/dialog";
import { initParser } from "../../shared/parsers/fallout-ssl";
import { transpile } from "../../transpilers/tssl/src/index";

const mockedTranspile = vi.mocked(transpile);

beforeAll(async () => {
    await initParser();
});

describe("tssl/dialog", () => {
    describe("parseTSSLDialog()", () => {
        it("returns empty data when parser not initialized", async () => {
            const mod = await import("../../shared/parsers/fallout-ssl");
            const spy = vi.spyOn(mod, "isInitialized").mockReturnValueOnce(false);

            const result = await parseTSSLDialog("file:///test.tssl", "// anything");

            expect(result).toEqual({ nodes: [], entryPoints: [] });
            spy.mockRestore();
        });

        it("parses a simple TSSL dialog with Reply and NOption", async () => {
            // SSL output that the transpiler would produce from a simple TSSL dialog
            const sslText = `
procedure Node001 begin
    Reply(100);
    NOption(101, Node002, 4);
end

procedure Node002 begin
    Reply(200);
    NMessage(201);
end

procedure talk_p_proc begin
    call Node001;
end
`;
            mockedTranspile.mockResolvedValueOnce(sslText);

            const result = await parseTSSLDialog("file:///test.tssl", "// tssl source");

            expect(result.entryPoints).toContain("Node001");
            expect(result.nodes).toHaveLength(2);

            const node1 = result.nodes.find((n) => n.name === "Node001");
            expect(node1).toBeDefined();
            expect(node1!.replies).toHaveLength(1);
            expect(node1!.replies[0]!.msgId).toBe(100);
            expect(node1!.options).toHaveLength(1);
            expect(node1!.options[0]!.target).toBe("Node002");

            const node2 = result.nodes.find((n) => n.name === "Node002");
            expect(node2).toBeDefined();
            expect(node2!.replies).toHaveLength(1);
            expect(node2!.options).toHaveLength(1);
            expect(node2!.options[0]!.type).toBe("NMessage");
        });

        it("parses talk_p_proc entry points from transpiled output", async () => {
            const sslText = `
procedure NodeA begin
    Reply(10);
    NMessage(11);
end

procedure NodeB begin
    Reply(20);
    NMessage(21);
end

procedure talk_p_proc begin
    if (local_var(0)) then
        call NodeA;
    else
        call NodeB;
    end
end
`;
            mockedTranspile.mockResolvedValueOnce(sslText);

            const result = await parseTSSLDialog("file:///dialog.tssl", "// tssl source");

            expect(result.entryPoints).toContain("NodeA");
            expect(result.entryPoints).toContain("NodeB");
            expect(result.nodes).toHaveLength(2);
        });

        it("passes file path and text to transpile()", async () => {
            const sslText = `procedure talk_p_proc begin end`;
            mockedTranspile.mockResolvedValueOnce(sslText);

            await parseTSSLDialog("file:///path/to/script.tssl", "const x = 1;");

            expect(mockedTranspile).toHaveBeenCalledWith("/path/to/script.tssl", "const x = 1;");
        });

        it("collects call_stmt (call_expr target) entries from parseProcedure body", async () => {
            // call_stmt where target is call_expr: "call Node002(0);" inside a Node proc.
            // Covers lines 167-173 (call_stmt in parseProcedure).
            const sslText = `
procedure Node001 begin
    Reply(100);
    call Node002(0);
end

procedure Node002 begin
    NMessage(200);
end

procedure talk_p_proc begin
    call Node001;
end
`;
            mockedTranspile.mockResolvedValueOnce(sslText);

            const result = await parseTSSLDialog("file:///test.tssl", "// tssl");

            expect(result.entryPoints).toContain("Node001");
            const node1 = result.nodes.find((n) => n.name === "Node001");
            expect(node1).toBeDefined();
            // callTargets should include Node002 (collected via call_stmt in parseProcedure)
            expect(node1!.callTargets).toContain("Node002");
        });

        it("collects direct call_expr nodes from talk_p_proc (Node() call syntax)", async () => {
            // Covers lines 105-108 in extractEntryPoints: a bare call_expr (not call_stmt)
            // like "Node001();" appears as a standalone expression in the procedure body.
            const sslText = `
procedure Node001 begin
    Reply(10);
    NMessage(11);
end

procedure talk_p_proc begin
    if (local_var(0)) then Node001(); end
end
`;
            mockedTranspile.mockResolvedValueOnce(sslText);

            const result = await parseTSSLDialog("file:///test.tssl", "// tssl");

            // Node001 collected via call_expr inside talk_p_proc (lines 105-108)
            expect(result.entryPoints).toContain("Node001");
        });

        it("handles non-numeric message IDs in Reply/NOption (parseArgValue string branch)", async () => {
            // Covers line 197 in parseArgValue: returns node.text when node.type !== "number"
            const sslText = `
procedure Node001 begin
    Reply(MSG_ID_CONST);
    NOption(OPTION_MSG, Node002, 0);
end

procedure Node002 begin
    NMessage(200);
end

procedure talk_p_proc begin
    call Node001;
end
`;
            mockedTranspile.mockResolvedValueOnce(sslText);

            const result = await parseTSSLDialog("file:///test.tssl", "// tssl");

            const node1 = result.nodes.find((n) => n.name === "Node001");
            expect(node1).toBeDefined();
            // msgId should be the text of the identifier (string branch of parseArgValue)
            expect(node1!.replies[0]!.msgId).toBe("MSG_ID_CONST");
            expect(node1!.options[0]!.msgId).toBe("OPTION_MSG");
        });
    });
});
