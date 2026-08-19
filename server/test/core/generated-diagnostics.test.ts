/**
 * Compiler diagnostics for a generated file, moved onto the source the author actually wrote.
 *
 * A transpiled language compiles in two steps - TSSL to SSL, then SSL to bytecode - and only the second
 * step produces compiler diagnostics. Left where they land, they point into a file the author never typed
 * and may not have open, at a line number that means nothing to them. The transpiler records which source
 * line each generated line came from, which is what lets the diagnostic be placed where the fix goes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Diagnostic } from "vscode-languageserver/node";

const published = new Map<string, Diagnostic[]>();
vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: ({ uri, diagnostics }: { uri: string; diagnostics: Diagnostic[] }) => {
            published.set(uri, diagnostics);
        },
    }),
}));

const { setDiagnostics, clearAllDiagnostics } = await import("../../src/diagnostic-store");
const { relocateGeneratedDiagnostics } = await import("../../src/core/generated-diagnostics");

const GENERATED = "file:///mod/scripts/hero.ssl";
const SOURCE = "file:///mod/scripts/hero.tssl";
const HEADER = "file:///mod/scripts/shared.tssl";

/** A compiler error the SSL compiler would have reported on `line` (0-based) of the generated file. */
function errorAt(line: number, message: string): Diagnostic {
    return {
        severity: 1,
        range: { start: { line, character: 0 }, end: { line, character: 4 } },
        message,
        source: "BGforge MLS",
    };
}

function messagesOn(uri: string): string[] {
    return (published.get(uri) ?? []).map((d) => String(d.message));
}

function linesOn(uri: string): number[] {
    return (published.get(uri) ?? []).map((d) => d.range.start.line);
}

describe("relocateGeneratedDiagnostics", () => {
    beforeEach(() => {
        for (const uri of [GENERATED, SOURCE, HEADER]) clearAllDiagnostics(uri);
        published.clear();
    });

    it("moves a diagnostic to the source line the generated line came from", () => {
        setDiagnostics(GENERATED, "compiler", [errorAt(7, "unknown identifier 'nope'")]);

        relocateGeneratedDiagnostics(GENERATED, [
            ...Array.from({ length: 7 }, () => undefined),
            { file: "/mod/scripts/hero.tssl", line: 2 },
        ]);

        expect(messagesOn(SOURCE)).toEqual(["unknown identifier 'nope'"]);
        expect(linesOn(SOURCE)).toEqual([2]);
        expect(messagesOn(GENERATED)).toEqual([]);
    });

    // An unmapped line is generated scaffolding with no author line behind it. Guessing a line would put
    // the error on unrelated code, so it stays where it can at least be read against real text.
    it("leaves a diagnostic whose line maps nowhere on the generated file", () => {
        setDiagnostics(GENERATED, "compiler", [errorAt(3, "unexpected end of file")]);

        relocateGeneratedDiagnostics(GENERATED, [undefined, undefined, undefined, undefined]);

        expect(messagesOn(GENERATED)).toEqual(["unexpected end of file"]);
        expect(messagesOn(SOURCE)).toEqual([]);
    });

    it("splits diagnostics across the files their lines came from", () => {
        setDiagnostics(GENERATED, "compiler", [errorAt(0, "in the entry"), errorAt(1, "in the import")]);

        relocateGeneratedDiagnostics(GENERATED, [
            { file: "/mod/scripts/hero.tssl", line: 4 },
            { file: "/mod/scripts/shared.tssl", line: 9 },
        ]);

        expect(messagesOn(SOURCE)).toEqual(["in the entry"]);
        expect(linesOn(SOURCE)).toEqual([4]);
        expect(messagesOn(HEADER)).toEqual(["in the import"]);
        expect(linesOn(HEADER)).toEqual([9]);
        expect(messagesOn(GENERATED)).toEqual([]);
    });

    // The generated file gets parsed like any other, so it carries tree-sitter diagnostics of its own.
    // Only the compiler's belong to the source.
    it("leaves the generated file's other diagnostics alone", () => {
        setDiagnostics(GENERATED, "tree-sitter", [errorAt(5, "syntax warning")]);
        setDiagnostics(GENERATED, "compiler", [errorAt(0, "compiler error")]);

        relocateGeneratedDiagnostics(GENERATED, [{ file: "/mod/scripts/hero.tssl", line: 0 }]);

        expect(messagesOn(GENERATED)).toEqual(["syntax warning"]);
        expect(messagesOn(SOURCE)).toEqual(["compiler error"]);
    });

    it("keeps the range within the mapped line rather than carrying the generated columns over", () => {
        setDiagnostics(GENERATED, "compiler", [errorAt(0, "unknown identifier 'nope'")]);

        relocateGeneratedDiagnostics(GENERATED, [{ file: "/mod/scripts/hero.tssl", line: 6 }]);

        expect(published.get(SOURCE)?.[0]?.range).toEqual({
            start: { line: 6, character: 0 },
            end: { line: 6, character: 0 },
        });
    });

    it("does nothing when the generated file compiled clean", () => {
        relocateGeneratedDiagnostics(GENERATED, [{ file: "/mod/scripts/hero.tssl", line: 0 }]);

        expect(messagesOn(SOURCE)).toEqual([]);
        expect(messagesOn(GENERATED)).toEqual([]);
    });
});
