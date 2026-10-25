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
import * as msg from "@bgforge/shared/parsers/fallout-msg";
import * as tra from "@bgforge/shared/parsers/weidu-tra";
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

    it("accepts any text outside the braces, as the game skips it", () => {
        for (const src of [
            "# a header note\n{100}{}{x}",
            "// a note\n{100}{}{x}",
            "/* a note */\n{100}{}{x}",
            "{100}{}{ok}\nthis is a markerless loose line",
        ]) {
            const tree = msg.parseWithCache(src)!;
            expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
        }
    });

    it("flags a closing brace in a note, which the game refuses to load", () => {
        const tree = msg.parseWithCache("# stray } here\n{100}{}{x}")!;
        const diagnostics = collectParseDiagnostics(tree.rootNode);
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics[0]!.range.start).toEqual({ line: 0, character: 8 });
    });

    it("flags a padded number field at the number", () => {
        const tree = msg.parseWithCache("{100}{}{ok}\n{ 101 }{}{x}")!;
        const diagnostics = collectParseDiagnostics(tree.rootNode);
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics[0]!.range.start.line).toBe(1);
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

    it.each([
        ["concatenation", "@1 = ~a~ ^ ~b~ ^ bare\n"],
        ["a bare word", "@1 = bareword\n@2 = ~a~ [SND]ND\n"],
        ["a TLK reference", "@1 = #5\n"],
        ["a reference to another entry", "@1 = ~one~\n@2 = @1\n"],
        ["a nested block comment", "/* a /* b */ c */\n@1 = ~x~\n"],
        ["a five-tilde string with tildes", "@1 = ~~~~~a ~ b~~~~~\n"],
    ])("accepts %s, which the installer reads", (_name, text) => {
        const tree = tra.parseWithCache(text)!;
        expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
    });

    it("flags an unclosed double quote once, and not the entries after it", () => {
        const tree = tra.parseWithCache('@1 = ~one~\n@2 = "oops\n@3 = ~three~\n@4 = ~four~\n')!;
        const diagnostics = collectParseDiagnostics(tree.rootNode);
        expect(diagnostics).toHaveLength(1);
        expect([diagnostics[0]!.range.start.line, diagnostics[0]!.range.end.line]).toEqual([1, 1]);
    });

    it("flags an unclosed percent string once, and not the entries after it", () => {
        const tree = tra.parseWithCache("@1 = %oops\n@2 = ~two~\n")!;
        const diagnostics = collectParseDiagnostics(tree.rootNode);
        expect(diagnostics).toHaveLength(1);
        expect([diagnostics[0]!.range.start.line, diagnostics[0]!.range.end.line]).toEqual([0, 0]);
    });

    it("flags an unclosed block comment once, and not the entries after it", () => {
        const tree = tra.parseWithCache("@1 = ~one~\n/* oops\n@2 = ~two~\n@3 = ~three~\n")!;
        const diagnostics = collectParseDiagnostics(tree.rootNode);
        expect(diagnostics).toHaveLength(1);
        expect([diagnostics[0]!.range.start.line, diagnostics[0]!.range.end.line]).toEqual([1, 1]);
    });
});
