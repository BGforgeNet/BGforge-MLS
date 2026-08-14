/**
 * Unit tests for parse-error diagnostics on the MSG and TRA grammars.
 *
 * These grammars have no full LSP provider - they register a parser solely to
 * surface syntax errors as diagnostics. Each test drives the real tree-sitter
 * parser (not a hand-built node) so the ERROR / MISSING walk is exercised against
 * genuine error-recovery output, and guards that the grammars stay wired and keep
 * flagging malformed entries.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import * as msg from "../../../shared/parsers/fallout-msg";
import * as tra from "../../../shared/parsers/weidu-tra";
import { collectParseDiagnostics } from "../../src/shared/tree-sitter-diagnostics";

const SYNTAX_SOURCE = "BGforge MLS (syntax)";

beforeAll(async () => {
    await msg.initParser();
    await tra.initParser();
});

describe("fallout-msg parse errors", () => {
    it("returns no diagnostics for well-formed entries", () => {
        const tree = msg.parseWithCache("{100}{}{Hello there}\n{200}{snd}{Bye}")!;
        expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
    });

    it("flags a malformed entry (non-numeric id)", () => {
        const tree = msg.parseWithCache("{abc}{}{text}")!;
        const diagnostics = collectParseDiagnostics(tree.rootNode);
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics[0]!.severity).toBe(DiagnosticSeverity.Error);
        expect(diagnostics[0]!.source).toBe(SYNTAX_SOURCE);
    });

    it("flags an unterminated entry (missing closing brace)", () => {
        const tree = msg.parseWithCache("{200}{}{Bye")!;
        const diagnostics = collectParseDiagnostics(tree.rootNode);
        expect(diagnostics.some((d) => typeof d.message === "string" && d.message.startsWith("missing '"))).toBe(true);
    });

    it("accepts #, //, and /* */ marked comments without diagnostics", () => {
        for (const src of ["# a header note\n{100}{}{x}", "// a note\n{100}{}{x}", "/* a note */\n{100}{}{x}"]) {
            const tree = msg.parseWithCache(src)!;
            expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
        }
    });

    it("flags an unmarked (markerless) loose line as an error", () => {
        // A non-entry line must be a marked comment (#, //, /* */); markerless
        // free text is a likely typo, not a comment, so it is flagged.
        const tree = msg.parseWithCache("{100}{}{ok}\nthis is a markerless loose line")!;
        const diagnostics = collectParseDiagnostics(tree.rootNode);
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics[0]!.severity).toBe(DiagnosticSeverity.Error);
        expect(diagnostics[0]!.source).toBe(SYNTAX_SOURCE);
    });
});

describe("weidu-tra parse errors", () => {
    it("returns no diagnostics for well-formed entries", () => {
        const tree = tra.parseWithCache("@1 = ~Hello~\n@2 = ~Bye~ [SND]")!;
        expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
    });

    it("flags an entry missing the '=' separator", () => {
        const tree = tra.parseWithCache("@1 ~Hello~")!;
        const diagnostics = collectParseDiagnostics(tree.rootNode);
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics[0]!.severity).toBe(DiagnosticSeverity.Error);
        expect(diagnostics[0]!.source).toBe(SYNTAX_SOURCE);
    });

    it("flags a non-entry garbage line", () => {
        const tree = tra.parseWithCache("@1 = ~ok~\nqqq zzz nonsense")!;
        const diagnostics = collectParseDiagnostics(tree.rootNode);
        expect(diagnostics.some((d) => typeof d.message === "string" && d.message.startsWith("Syntax error"))).toBe(
            true,
        );
    });
});
