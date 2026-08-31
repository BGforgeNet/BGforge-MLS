/**
 * Reporting every syntax error a script has, rather than the first.
 *
 * Tree-sitter has already found all of them by the time lowering starts; taking only the first is what
 * turns a script with four mistakes into four compile-and-read cycles. What makes reporting all of them
 * useful rather than overwhelming is the one rule in the shared walk: an ERROR node's descendants are
 * recovery debris and are not reported, so the count tracks real mistakes instead of the parser's
 * flailing around them.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { CompileError, buildProgram } from "../src/compile.ts";
import { collectParseErrors, findParseError } from "../../../shared/parse-errors.ts";
import { REPO_ROOT } from "../../../shared/cli/test/repo-root.ts";
import { builtArtifactsPresent } from "../../../shared/cli/test/built-artifacts.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");
const wasmPresent = builtArtifactsPresent([path.join(WASM_DIR, "tree-sitter-ssl.wasm")], "pnpm build:grammar");

describe.skipIf(!wasmPresent)("syntax errors", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    /** The diagnostics a refused compile carries, or a failure if it did not refuse. */
    function diagnosticsOf(source: string) {
        try {
            buildProgram(parser, source);
        } catch (error) {
            if (error instanceof CompileError) return error.diagnostics;
            throw error;
        }
        throw new Error("expected the compile to be refused");
    }

    it("reports every bad statement, not just the first", () => {
        const diagnostics = diagnosticsOf("procedure start begin\n variable &a;\n variable &b;\n variable &c;\nend\n");

        expect(diagnostics.length).toBeGreaterThanOrEqual(3);
        expect(diagnostics.map((d) => d.line).slice(0, 3)).toEqual([2, 3, 4]);
    });

    it("keeps the message and position of the first one exactly as a single-error compile had them", () => {
        // The language server reads this prefix to place the diagnostic, and a caller that can only show
        // one error still shows this one, so it is the part that may not drift.
        expect(() => buildProgram(parser, "procedure start begin\n variable &x;\nend\n")).toThrow(
            /^2:\d+: syntax error$/,
        );
    });

    it("reports an unfinished construct by the token that is missing", () => {
        const diagnostics = diagnosticsOf("procedure start begin\n variable x := 1;\n");

        expect(diagnostics.at(-1)).toMatchObject({ line: 3, column: 1, message: "missing end" });
    });

    it("does not report the debris inside one bad statement as separate errors", () => {
        // A single unspellable name is one mistake. Descending into the ERROR node would turn it into a
        // handful, which is the failure mode that makes reporting everything worse than reporting one.
        expect(diagnosticsOf("procedure start begin\n variable &&&x;\nend\n")).toHaveLength(1);
    });

    it("agrees with the first-error search the formatter uses", () => {
        // Two walks over the same tree, so they can drift apart; the formatter refuses at findParseError's
        // node while the compiler reports from this list, and the two must name the same first mistake.
        for (const source of [
            "procedure start begin\n variable &a;\n variable &b;\nend\n",
            "procedure start begin\n variable x := 1;\n",
            "procedure start begin end\n",
        ]) {
            const tree = parser.parse(source);
            // By `id`, not by reference: tree-sitter hands back a fresh wrapper object per access, so two
            // walks reaching the same node never produce the same JS value.
            const first = findParseError(tree!.rootNode);
            expect(collectParseErrors(tree!.rootNode)[0]?.id ?? null).toBe(first?.id ?? null);
            tree!.delete();
        }
    });
});
