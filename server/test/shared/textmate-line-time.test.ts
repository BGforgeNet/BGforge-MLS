/**
 * Tokenizing one long line takes time linear in its length, through the same TextMate engine and Oniguruma build VS
 * Code runs. Each line below is the input that made one grammar pattern search in quadratic time: every start position
 * in a run of the same character began a new attempt that rescanned the rest of the run. The static check over every
 * pattern is `scripts/utils/test/syntaxes-backtracking.test.ts`; this pins the effect where the user sees it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { INITIAL, parseRawGrammar, Registry } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { cpuTimeMs } from "@bgforge/shared/cpu-time";

const SYNTAXES_DIR = path.resolve(__dirname, "../../../syntaxes");
const ONIG_WASM_PATH = createRequire(__filename).resolve("vscode-oniguruma/release/onig.wasm");

/** Below VS Code's default `editor.maxTokenizationLineLength` (20000), past which a line is not tokenized at all. */
const LINE_LENGTH = 16_000;
/** Generous for a linear tokenization of one such line, which takes a few milliseconds; quadratic took seconds. */
const BOUND_MS = 500;

interface Case {
    readonly scope: string;
    readonly name: string;
    readonly line: string;
}

const run = (text: string): string => text.repeat(LINE_LENGTH / text.length);

const CASES: readonly Case[] = [
    { scope: "source.fallout-ssl", name: "a run of blanks before a call", line: `${run(" ")}a(` },
    { scope: "source.fallout-worldmap-txt", name: "a long word in terrain_types", line: `terrain_types=${run("a")}:` },
    { scope: "source.weidu-baf-tooltip", name: "a long word before `(`", line: `)${run("a")}(` },
    { scope: "source.weidu-baf-tooltip", name: "a long word before `:`", line: `${run("a")}:` },
    { scope: "source.weidu-d", name: "a run of blanks before `+~~~~~`", line: `${run(" ")}+~~~~~` },
    { scope: "source.weidu-d", name: "a run of `[`", line: run("[") },
    { scope: "source.weidu-tra", name: "a run of `[`", line: run("[") },
];

let registry: Registry;

beforeAll(async () => {
    await loadWASM(readFileSync(ONIG_WASM_PATH).buffer);
    const files = new Map<string, string>();
    for (const name of readdirSync(SYNTAXES_DIR).filter((file) => file.endsWith(".tmLanguage.json"))) {
        const file = path.join(SYNTAXES_DIR, name);
        const { scopeName } = JSON.parse(readFileSync(file, "utf-8")) as { scopeName: string };
        files.set(scopeName, file);
    }
    registry = new Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
            createOnigString: (text: string) => new OnigString(text),
        }),
        loadGrammar: async (scopeName) => {
            const file = files.get(scopeName);
            return file === undefined ? null : parseRawGrammar(readFileSync(file, "utf-8"), file);
        },
    });
});

describe("TextMate grammars: one long line", () => {
    it.each(CASES)("$scope: tokenizes $name in linear time", async ({ scope, line }) => {
        const grammar = await registry.loadGrammar(scope);
        expect(grammar).not.toBeNull();
        // Compile the grammar's scanners on a short line first, so the timed call pays only for searching.
        grammar?.tokenizeLine(line.slice(0, 64), INITIAL);

        const elapsed = cpuTimeMs(() => grammar?.tokenizeLine(line, INITIAL));

        expect(elapsed).toBeLessThan(BOUND_MS);
    });
});
