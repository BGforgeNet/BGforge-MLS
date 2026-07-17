/**
 * Real-parse coverage for weidu-tp2 isInsideString - the input to the definition handler's
 * string gate. Asserts it flags positions inside path strings and clears plain code identifiers,
 * so the handler can safely skip the bare-word symbol fallback on string content.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import type { Position } from "vscode-languageserver/node";

vi.mock("../../src/server", () => ({
    connection: { console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }, sendDiagnostics: vi.fn() },
}));

import { isInsideString } from "../../src/weidu-tp2/ast-utils";
import { initParser } from "../../../shared/parsers/weidu-tp2";

beforeAll(async () => {
    await initParser();
});

/** Column of the first occurrence of `needle` on `line`, offset into its middle. */
function midOf(text: string, lineNo: number, needle: string): Position {
    const line = text.split("\n")[lineNo] ?? "";
    const col = line.indexOf(needle);
    return { line: lineNo, character: col + Math.floor(needle.length / 2) };
}

describe("weidu-tp2 isInsideString", () => {
    it("is true on a filename inside an INCLUDE double-string", () => {
        const text = `INCLUDE "%loc%/balthazar_monk_resources.tpa"`;
        expect(isInsideString(text, midOf(text, 0, "balthazar_monk_resources"))).toBe(true);
    });

    it("is true inside a tilde COPY path", () => {
        const text = `COPY ~mymod/item.itm~ ~override/item.itm~`;
        expect(isInsideString(text, midOf(text, 0, "item.itm"))).toBe(true);
    });

    it("is false on a bare directive keyword outside any string", () => {
        const text = `INCLUDE "file.tpa"`;
        expect(isInsideString(text, midOf(text, 0, "INCLUDE"))).toBe(false);
    });

    it("is false on a function-call identifier outside a string", () => {
        const text = `DEFINE_ACTION_FUNCTION balthazar_monk_resources BEGIN END`;
        expect(isInsideString(text, midOf(text, 0, "balthazar_monk_resources"))).toBe(false);
    });
});
