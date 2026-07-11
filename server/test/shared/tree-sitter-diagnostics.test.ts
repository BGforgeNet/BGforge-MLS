/**
 * Unit tests for shared/tree-sitter-diagnostics.ts - parse-error extraction.
 *
 * Drives the real fallout-ssl tree-sitter parser (not a hand-built node) so the
 * ERROR / MISSING walk is exercised against genuine error-recovery output.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { initParser, parseWithCache } from "../../../shared/parsers/fallout-ssl";
import { collectParseErrors } from "../../src/shared/tree-sitter-diagnostics";

beforeAll(async () => {
    await initParser();
});

const SYNTAX_SOURCE = "BGforge MLS (syntax)";

describe("collectParseErrors", () => {
    it("returns no diagnostics for a clean parse", () => {
        const text = `procedure foo begin
    variable x;
end
`;
        const tree = parseWithCache(text)!;
        expect(collectParseErrors(tree.rootNode)).toEqual([]);
    });

    it("reports parse errors for malformed input", () => {
        // A stray, unparseable token sequence forces tree-sitter into error recovery.
        const text = `procedure foo begin
    @@@ !!! ###
end
`;
        const tree = parseWithCache(text)!;
        const diagnostics = collectParseErrors(tree.rootNode);

        expect(diagnostics.length).toBeGreaterThan(0);
        for (const d of diagnostics) {
            expect(d.severity).toBe(DiagnosticSeverity.Error);
            expect(d.source).toBe(SYNTAX_SOURCE);
            // Range is well-formed: end is at or after start (line-aware, since a
            // multi-line span ends at a smaller column on a later line).
            expect(d.range.start.line).toBeGreaterThanOrEqual(0);
            const endNotBeforeStart =
                d.range.end.line > d.range.start.line ||
                (d.range.end.line === d.range.start.line && d.range.end.character >= d.range.start.character);
            expect(endNotBeforeStart).toBe(true);
        }
        // Every message is one of the two shapes we emit.
        for (const d of diagnostics) {
            expect(d.message).toMatch(/^(Syntax error|missing ')/);
        }
    });

    it("anchors an ERROR-node message on the offending token", () => {
        const text = `procedure foo begin
    @@@
end
`;
        const tree = parseWithCache(text)!;
        const diagnostics = collectParseErrors(tree.rootNode);
        const errorDiag = diagnostics.find(
            (d) => typeof d.message === "string" && d.message.startsWith("Syntax error"),
        );
        expect(errorDiag).toBeDefined();
        // "near '<token>'" carries the offending text, not a bare "Syntax error".
        expect(errorDiag!.message).toContain("near '");
    });
});
