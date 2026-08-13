/**
 * Structural guard for committed VSCode snippet files (snippets/*.json).
 *
 * data-json-well-formed.test.ts already confirms these parse as JSONC; this asserts the
 * per-snippet shape VSCode requires to register a usable completion: a non-empty prefix
 * and a non-empty body.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

interface RawSnippet {
    prefix?: unknown;
    body?: unknown;
}

function lsFiles(...patterns: string[]): string[] {
    const spec = patterns.map((p) => `'${p}'`).join(" ");
    return execSync(`git ls-files -- ${spec}`, { encoding: "utf8", timeout: SPAWN_TIMEOUT_MS })
        .split("\n")
        .filter(Boolean);
}

const snippetFiles = lsFiles("snippets/*.json");

describe("committed snippets have a usable shape", () => {
    it("discovers snippet files", () => {
        expect(snippetFiles.length).toBeGreaterThan(0);
    });

    it.each(snippetFiles)("%s snippets have non-empty prefix and body", (file) => {
        const snippets = parse(fs.readFileSync(file, "utf8"), [], { allowTrailingComma: true }) as Record<
            string,
            RawSnippet
        >;
        for (const [name, snippet] of Object.entries(snippets)) {
            const prefixOk = typeof snippet.prefix === "string" && snippet.prefix.length > 0;
            const bodyOk = Array.isArray(snippet.body)
                ? snippet.body.length > 0
                : typeof snippet.body === "string" && snippet.body.length > 0;
            expect(prefixOk, `${file} > "${name}" has a non-empty prefix`).toBe(true);
            expect(bodyOk, `${file} > "${name}" has a non-empty body`).toBe(true);
        }
    });
});
