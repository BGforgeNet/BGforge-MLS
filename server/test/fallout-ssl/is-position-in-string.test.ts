/**
 * Real-parse coverage for fallout-ssl isInsideString - the input to the definition handler's
 * string gate. Asserts it flags positions inside #include path strings and clears plain code
 * identifiers, so a filename in an #include cannot wrong-jump to a same-named procedure.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import type { Position } from "vscode-languageserver/node";

vi.mock("../../src/server", () => ({
    connection: { console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }, sendDiagnostics: vi.fn() },
}));

import { isInsideString } from "../../src/fallout-ssl/completion-context";
import { initParser } from "../../../shared/parsers/fallout-ssl";

beforeAll(async () => {
    await initParser();
});

function midOf(text: string, lineNo: number, needle: string): Position {
    const line = text.split("\n")[lineNo] ?? "";
    const col = line.indexOf(needle);
    return { line: lineNo, character: col + Math.floor(needle.length / 2) };
}

describe("fallout-ssl isInsideString", () => {
    it("is true on a filename inside a quoted #include path", () => {
        const text = `#include "headers/sfall.h"\nprocedure main begin end`;
        expect(isInsideString(text, midOf(text, 0, "sfall"))).toBe(true);
    });

    it("is true inside an angle-bracket #include path", () => {
        const text = `#include <define.h>\nprocedure main begin end`;
        expect(isInsideString(text, midOf(text, 0, "define"))).toBe(true);
    });

    it("is false on a procedure name in code", () => {
        const text = `procedure sfall begin end`;
        expect(isInsideString(text, midOf(text, 0, "sfall"))).toBe(false);
    });
});
