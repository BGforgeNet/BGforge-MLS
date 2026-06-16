/**
 * Unit tests for td/dialog.ts - TD dialog parser for tree visualization.
 * Mocks the TD transpiler at the public-API barrel and tests that parseTDDialog
 * routes the transpiled D output through the existing D dialog parser.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

// Mock the server module to avoid LSP connection issues in the D parser path.
vi.mock("../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

// Mock the TD transpiler at the public-API barrel - it requires esbuild,
// ts-morph, and file I/O. We return pre-built D text so the test focuses on
// the dialog parsing pipeline.
vi.mock("../../transpilers/src/index", () => ({
    td: vi.fn(),
}));

import { parseTDDialog } from "../src/td/dialog";
import { initParser, isInitialized } from "../../shared/parsers/weidu-d";
import { td } from "../../transpilers/src/index";

const mockedTd = vi.mocked(td);

beforeAll(async () => {
    await initParser();
});

describe("td/dialog", () => {
    describe("parseTDDialog()", () => {
        it("returns empty data when parser not initialized", async () => {
            const mod = await import("../../shared/parsers/weidu-d");
            const spy = vi.spyOn(mod, "isInitialized").mockReturnValueOnce(false);

            const result = await parseTDDialog("file:///test.td", "// anything");

            expect(result).toEqual({ blocks: [], states: [] });
            expect(mockedTd).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        it("routes transpiled D output through the D dialog parser", async () => {
            // D text the transpiler would produce; parseTDDialog must feed it to parseDDialog.
            const dText = `
BEGIN ~GAELAN~

IF ~True()~ THEN BEGIN start_state
    SAY ~Hello traveler!~
    IF ~~ THEN REPLY ~Goodbye~ EXIT
END
`;
            mockedTd.mockResolvedValueOnce({ output: dText, warnings: [] });

            const result = await parseTDDialog("file:///test.td", "// td source");

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("begin");
            expect(result.blocks[0]!.file).toBe("GAELAN");
            expect(result.states).toHaveLength(1);

            const state0 = result.states[0]!;
            expect(state0.label).toBe("start_state");
            expect(state0.sayText).toBe("Hello traveler!");
            expect(state0.transitions).toHaveLength(1);
            expect(state0.transitions[0]!.replyText).toBe("Goodbye");
            expect(state0.transitions[0]!.target).toEqual({ kind: "exit" });
        });

        it("passes the file path and source text to the transpiler", async () => {
            expect(isInitialized()).toBe(true);
            mockedTd.mockResolvedValueOnce({ output: "BEGIN ~X~", warnings: [] });

            await parseTDDialog("file:///path/to/script.td", "const x = 1;");

            expect(mockedTd).toHaveBeenCalledWith("/path/to/script.td", "const x = 1;");
        });
    });
});
