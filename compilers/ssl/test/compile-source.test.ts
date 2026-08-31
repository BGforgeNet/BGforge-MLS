/**
 * The one call a consumer makes to compile a document: bytes out, or located problems - never a thrown
 * refusal to catch and flatten. The language server's worker is the consumer this exists for; before it,
 * every consumer re-built the same catch-flatten-map sequence, and one that missed a refusal shape
 * silently degraded (the compiled-script editor once knew `CompileError` and lowering threw its own).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { compileSource } from "../src/compile.ts";
import { REPO_ROOT } from "../../../shared/cli/test/repo-root.ts";
import { builtArtifactsPresent } from "../../../shared/cli/test/built-artifacts.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");
const wasmPresent = builtArtifactsPresent([path.join(WASM_DIR, "tree-sitter-ssl.wasm")], "pnpm build:grammar");

describe.skipIf(!wasmPresent)("compileSource", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    /** Compiles in-memory text as a file in a scratch directory holding `files`. */
    function compileWith(text: string, files: Record<string, string> = {}, options = {}) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssl-src-"));
        try {
            for (const [name, body] of Object.entries(files)) {
                fs.writeFileSync(path.join(dir, name), body);
            }
            return { result: compileSource(parser, text, path.join(dir, "main.ssl"), options), dir };
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    it("returns bytes and no problems for a sound script", () => {
        const { result } = compileWith('procedure start begin\n display_msg("hi");\nend\n');
        expect(result.problems).toEqual([]);
        expect(result.bytes?.length).toBeGreaterThan(0);
    });

    it("returns every problem in source coordinates, and no bytes", () => {
        const { result } = compileWith("#define X 9\nprocedure start begin\n a := nope1;\n b := nope2;\nend\n");
        expect(result.bytes).toBeUndefined();
        expect(result.problems.map((p) => p.line)).toEqual([3, 4]);
        expect(result.problems[0]?.message).toMatch(/unknown identifier/);
    });

    it("names the header a preprocessor refusal came from", () => {
        const { result, dir } = compileWith('#include "hdr.h"\nprocedure start begin end\n', {
            "hdr.h": "#bogus\n",
        });
        expect(result.bytes).toBeUndefined();
        expect(result.problems[0]?.file).toBe(path.join(dir, "hdr.h"));
        expect(result.problems[0]?.line).toBe(1);
    });

    it("collects warnings in source coordinates beside a successful compile", () => {
        const { result } = compileWith(
            "#define PAD 1\nvariable g := 1;\nvariable g := 2;\nprocedure start begin end\n",
        );
        expect(result.bytes?.length).toBeGreaterThan(0);
        expect(result.warnings).toMatchObject([{ line: 3, column: 10 }]);
    });

    it("keeps the warnings found before a refusal stopped the compile", () => {
        const { result } = compileWith("variable g := 1;\nvariable g := 2;\nprocedure start begin\n a := nope;\nend\n");
        expect(result.bytes).toBeUndefined();
        expect(result.problems).toHaveLength(1);
        expect(result.warnings).toMatchObject([{ line: 2 }]);
    });

    it("reports an unlocatable failure at the top of the file rather than throwing", () => {
        // A parser with no language loaded fails outside every refusal shape the compiler owns.
        const { result } = compileWith("procedure start begin end\n", {}, {});
        expect(result).toBeDefined();
        const bare = compileSource(new Parser(), "procedure start begin end\n", "/virtual/x.ssl");
        expect(bare.bytes).toBeUndefined();
        expect(bare.problems).toMatchObject([{ line: 1 }]);
    });
});
