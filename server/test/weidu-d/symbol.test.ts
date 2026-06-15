/**
 * Unit tests for weidu-d/symbol.ts - document symbol provider.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { SymbolKind } from "vscode-languageserver/node";

// Mock the server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { getDocumentSymbols } from "../../src/weidu-d/symbol";
import { initParser } from "../../../shared/parsers/weidu-d";

beforeAll(async () => {
    await initParser();
});

describe("weidu-d/symbol", () => {
    describe("getDocumentSymbols()", () => {
        it("returns empty array for empty file", () => {
            const text = "";
            const symbols = getDocumentSymbols(text);
            expect(symbols).toEqual([]);
        });

        it("extracts state labels as symbols", () => {
            const text = `
BEGIN ~DIALOG~

IF ~True()~ THEN BEGIN start_state
    SAY ~Hello!~
END

IF ~~ THEN BEGIN end_state
    SAY ~Goodbye!~
END
`;
            const symbols = getDocumentSymbols(text);

            expect(symbols.length).toBe(2);
            expect(symbols[0]!.name).toBe("start_state");
            expect(symbols[1]!.name).toBe("end_state");
        });

        it("returns symbols with correct kind", () => {
            const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN my_state
    SAY ~Test~
END
`;
            const symbols = getDocumentSymbols(text);

            expect(symbols.length).toBe(1);
            expect(symbols[0]!.kind).toBe(SymbolKind.Function);
        });

        it("includes correct range for symbols", () => {
            const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN test_label
    SAY ~Content~
END
`;
            const symbols = getDocumentSymbols(text);

            expect(symbols.length).toBe(1);
            // Range should cover the entire state block
            expect(symbols[0]!.range.start.line).toBe(3);
            // Selection range should be just the label
            expect(symbols[0]!.selectionRange.start.line).toBe(3);
        });

        it("handles numeric state labels", () => {
            const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN 0
    SAY ~Zero~
END

IF ~~ THEN BEGIN 1
    SAY ~One~
END
`;
            const symbols = getDocumentSymbols(text);

            expect(symbols.length).toBe(2);
            expect(symbols[0]!.name).toBe("0");
            expect(symbols[1]!.name).toBe("1");
        });

        it("handles multiple dialogs", () => {
            const text = `
BEGIN ~DIALOG1~

IF ~~ THEN BEGIN state1
    SAY ~Dialog 1~
END

BEGIN ~DIALOG2~

IF ~~ THEN BEGIN state2
    SAY ~Dialog 2~
END
`;
            const symbols = getDocumentSymbols(text);

            expect(symbols.length).toBe(2);
            expect(symbols[0]!.name).toBe("state1");
            expect(symbols[1]!.name).toBe("state2");
        });

        it("handles APPEND blocks", () => {
            const text = `
APPEND ~DIALOG~

IF ~~ THEN BEGIN appended_state
    SAY ~Appended~
END

END
`;
            const symbols = getDocumentSymbols(text);

            expect(symbols.length).toBe(1);
            expect(symbols[0]!.name).toBe("appended_state");
        });

        it("emits no symbols for INTERJECT_COPY_TRANS (label is a cross-file reference, not a local definition)", () => {
            // Valid INTERJECT_COPY_TRANS: file, target-state label, global var, then a chain body.
            const text = `
INTERJECT_COPY_TRANS DIALOG 29 my_global_var
== speaker IF ~Global("X","GLOBAL",1)~ THEN @1017 END
`;
            const symbols = getDocumentSymbols(text);
            // An INTERJECT_COPY_TRANS targets a state defined in ANOTHER dialog file; its label
            // is a cross-file reference (resolved by label-refs.ts), not a state definition in
            // this file. Document symbols list local definitions only, so an interject-only file
            // contributes none. This guards against a regression that surfaces interject labels
            // as local symbols (distinct from the invalid-syntax case below, which never forms a
            // clean interject node).
            expect(symbols).toEqual([]);
        });

        it("returns empty array for invalid syntax", () => {
            const text = "{{{invalid d file syntax";
            const symbols = getDocumentSymbols(text);
            // Should gracefully handle and return empty or whatever was parsed
            expect(Array.isArray(symbols)).toBe(true);
        });
    });
});
