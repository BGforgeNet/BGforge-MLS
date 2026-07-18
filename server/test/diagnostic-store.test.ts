/**
 * Unit tests for diagnostic-store.ts - the per-source diagnostic store that lets
 * the compiler and tree-sitter sources publish to the same file without
 * clobbering each other.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { type Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";

const mockSendDiagnostics = vi.fn();
vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({ sendDiagnostics: mockSendDiagnostics }),
}));

import { setDiagnostics, clearCompilerDiagnostics, clearAllDiagnostics } from "../src/diagnostic-store";

function diag(message: string): Diagnostic {
    return {
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        message,
        source: "test",
    };
}

/** Last diagnostics array published for `uri`. */
function lastPublished(uri: string): Diagnostic[] | undefined {
    for (let i = mockSendDiagnostics.mock.calls.length - 1; i >= 0; i--) {
        const call = mockSendDiagnostics.mock.calls[i];
        if (!call) continue;
        const arg = call[0] as { uri: string; diagnostics: Diagnostic[] };
        if (arg.uri === uri) {
            return arg.diagnostics;
        }
    }
    return undefined;
}

describe("diagnostic-store", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("publishes a single source's diagnostics", () => {
        const uri = "file:///single.ssl";
        setDiagnostics(uri, "compiler", [diag("compile error")]);
        expect(lastPublished(uri)).toEqual([diag("compile error")]);
    });

    it("publishes the union of both sources without clobbering", () => {
        const uri = "file:///union.ssl";
        setDiagnostics(uri, "compiler", [diag("compile error")]);
        setDiagnostics(uri, "tree-sitter", [diag("syntax error")]);
        // Both sources present, order is compiler-then-tree-sitter (insertion order).
        expect(lastPublished(uri)).toEqual([diag("compile error"), diag("syntax error")]);
    });

    it("coexists across all three sources; clearing translation keeps the others", () => {
        const uri = "file:///three.d";
        setDiagnostics(uri, "compiler", [diag("compile error")]);
        setDiagnostics(uri, "tree-sitter", [diag("syntax error")]);
        setDiagnostics(uri, "translation", [diag("no entry 999")]);
        expect(lastPublished(uri)).toEqual([diag("compile error"), diag("syntax error"), diag("no entry 999")]);
        // The translation source clears independently (empty array drops just its bucket).
        setDiagnostics(uri, "translation", []);
        expect(lastPublished(uri)).toEqual([diag("compile error"), diag("syntax error")]);
    });

    it("re-setting one source replaces only that source's bucket", () => {
        const uri = "file:///replace.ssl";
        setDiagnostics(uri, "compiler", [diag("old compile")]);
        setDiagnostics(uri, "tree-sitter", [diag("syntax error")]);
        setDiagnostics(uri, "compiler", [diag("new compile")]);
        expect(lastPublished(uri)).toEqual([diag("new compile"), diag("syntax error")]);
    });

    it("clearCompilerDiagnostics leaves the tree-sitter source intact", () => {
        const uri = "file:///clear-compiler.ssl";
        setDiagnostics(uri, "compiler", [diag("compile error")]);
        setDiagnostics(uri, "tree-sitter", [diag("syntax error")]);
        clearCompilerDiagnostics(uri);
        expect(lastPublished(uri)).toEqual([diag("syntax error")]);
    });

    it("clearAllDiagnostics empties every source", () => {
        const uri = "file:///clear-all.ssl";
        setDiagnostics(uri, "compiler", [diag("compile error")]);
        setDiagnostics(uri, "tree-sitter", [diag("syntax error")]);
        clearAllDiagnostics(uri);
        expect(lastPublished(uri)).toEqual([]);
    });

    it("setting an empty array for a source clears just that source", () => {
        const uri = "file:///empty-one.ssl";
        setDiagnostics(uri, "compiler", [diag("compile error")]);
        setDiagnostics(uri, "tree-sitter", [diag("syntax error")]);
        setDiagnostics(uri, "tree-sitter", []);
        expect(lastPublished(uri)).toEqual([diag("compile error")]);
    });
});
