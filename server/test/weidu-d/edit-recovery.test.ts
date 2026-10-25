/**
 * Trees for dialog still being typed. A half-typed transition is the normal state of a file in the editor, so the
 * damage error recovery does must stay local: the states around the edit keep their nodes and stay in the outline.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { initParser, parseWithCache } from "@bgforge/shared/parsers/weidu-d";
import { getDocumentSymbols } from "../../src/weidu-d/symbol";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { collectParseDiagnostics, DIAG_SOURCE } from "../../src/shared/tree-sitter-diagnostics";

beforeAll(async () => {
    await initParser();
});

const APPEND_AFTER = "\nAPPEND ~dlg~\nIF ~~ THEN BEGIN a1 SAY ~x~ IF ~~ THEN EXIT END\nEND\n";

describe("a GOTO whose label is still being typed", () => {
    const text =
        "BEGIN ~dlg~\n" +
        "IF ~~ THEN BEGIN s1 SAY ~one~\n  IF ~~ THEN GOTO s2\nEND\n" +
        "IF ~~ THEN BEGIN s2 SAY ~two~\n  IF ~~ THEN GOTO\nEND\n" +
        "IF ~~ THEN BEGIN s3 SAY ~three~\n  IF ~~ THEN EXIT\nEND\n" +
        APPEND_AFTER;

    it("does not take the state's END for the label, so the next state survives", () => {
        expect(getDocumentSymbols(text).map((s) => s.name)).toEqual(["s1", "s2", "s3", "a1"]);
    });

    it("reports the missing label", () => {
        expect(parseWithCache(text)!.rootNode.hasError).toBe(true);
    });
});

describe("a state missing its END", () => {
    const text =
        "BEGIN ~dlg~\n" +
        "IF ~~ THEN BEGIN s1 SAY ~one~\n  IF ~~ THEN EXIT\n" +
        "IF ~~ THEN BEGIN s2 SAY ~two~\n  IF ~~ THEN EXIT\nEND\n" +
        APPEND_AFTER;

    it("keeps the next state in the outline", () => {
        expect(getDocumentSymbols(text).map((s) => s.name)).toEqual(["s1", "s2", "a1"]);
    });

    it("reports the missing END where it belongs, before the next state", () => {
        expect(collectParseDiagnostics(parseWithCache(text)!.rootNode)).toEqual([
            {
                severity: DiagnosticSeverity.Error,
                range: { start: { line: 3, character: 0 }, end: { line: 3, character: 1 } },
                message: "missing 'END'",
                source: DIAG_SOURCE,
            },
        ]);
    });
});
