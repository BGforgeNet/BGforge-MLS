/**
 * Tests for variable DeclarationKind inference in TP2 header parsing.
 * Verifies that READ_ASCII and READ_STRREF produce string declaration kinds,
 * not integer (which was a bug — they read strings, not numbers).
 *
 * Uses COPY blocks instead of DEFINE_PATCH_FUNCTION wrappers because
 * parseHeaderToSymbols skips function bodies (separate scope in WeiDU).
 * COPY blocks are top-level actions whose patch bodies ARE traversed.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { parseFile } from "../../src/weidu-tp2/header-parser";

/** Extract symbols only (convenience wrapper). */
const parseHeaderToSymbols = (...args: Parameters<typeof parseFile>) => [...parseFile(...args).symbols];
import { initParser } from "../../src/weidu-tp2/parser";
import { isVariableSymbol, DeclarationKind } from "../../src/core/symbol";

beforeAll(async () => {
    await initParser();
});

function getVarDeclarationKind(code: string, varName: string): DeclarationKind | undefined {
    const symbols = parseHeaderToSymbols("file:///test.tph", code);
    const sym = symbols.find((s) => s.name === varName);
    if (sym && isVariableSymbol(sym)) {
        return sym.variable.declarationKind;
    }
    return undefined;
}

describe("TP2 variable DeclarationKind inference", () => {
    describe("integer declarations", () => {
        it("SET produces DeclarationKind.Set", () => {
            const code = `COPY ~a~ ~b~ SET x = 1`;
            expect(getVarDeclarationKind(code, "x")).toBe(DeclarationKind.Set);
        });

        it("OUTER_SET produces DeclarationKind.Set", () => {
            const code = `OUTER_SET x = 1`;
            expect(getVarDeclarationKind(code, "x")).toBe(DeclarationKind.Set);
        });

        it("READ_BYTE produces DeclarationKind.Set", () => {
            const code = `COPY ~a~ ~b~ READ_BYTE 0x00 x`;
            expect(getVarDeclarationKind(code, "x")).toBe(DeclarationKind.Set);
        });

        it("READ_SHORT produces DeclarationKind.Set", () => {
            const code = `COPY ~a~ ~b~ READ_SHORT 0x00 x`;
            expect(getVarDeclarationKind(code, "x")).toBe(DeclarationKind.Set);
        });

        it("READ_LONG produces DeclarationKind.Set", () => {
            const code = `COPY ~a~ ~b~ READ_LONG 0x00 x`;
            expect(getVarDeclarationKind(code, "x")).toBe(DeclarationKind.Set);
        });
    });

    describe("string declarations", () => {
        it("SPRINT produces DeclarationKind.Sprint", () => {
            const code = `COPY ~a~ ~b~ SPRINT x ~hello~`;
            expect(getVarDeclarationKind(code, "x")).toBe(DeclarationKind.Sprint);
        });

        it("OUTER_SPRINT produces DeclarationKind.Sprint", () => {
            const code = `OUTER_SPRINT x ~hello~`;
            expect(getVarDeclarationKind(code, "x")).toBe(DeclarationKind.Sprint);
        });

        it("TEXT_SPRINT produces DeclarationKind.TextSprint", () => {
            const code = `COPY ~a~ ~b~ TEXT_SPRINT x ~hello~`;
            expect(getVarDeclarationKind(code, "x")).toBe(DeclarationKind.TextSprint);
        });

        it("OUTER_TEXT_SPRINT produces DeclarationKind.TextSprint", () => {
            const code = `OUTER_TEXT_SPRINT x ~hello~`;
            expect(getVarDeclarationKind(code, "x")).toBe(DeclarationKind.TextSprint);
        });

        it("READ_ASCII produces DeclarationKind.Sprint", () => {
            const code = `COPY ~a~ ~b~ READ_ASCII 0x00 x (8)`;
            expect(getVarDeclarationKind(code, "x")).toBe(DeclarationKind.Sprint);
        });

        it("READ_STRREF produces DeclarationKind.Sprint", () => {
            const code = `COPY ~a~ ~b~ READ_STRREF 0x00 x`;
            expect(getVarDeclarationKind(code, "x")).toBe(DeclarationKind.Sprint);
        });
    });
});
