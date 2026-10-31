/**
 * Every `match`, `begin`, `end` and `while` pattern of `syntaxes/*.tmLanguage.json` passes the analysis behind the
 * ReDoS lint on TypeScript regexes (eslint-plugin-regexp's `no-super-linear-backtracking` and
 * `no-super-linear-move`, both scslre): VS Code's tokenizer runs each pattern on every line of an open file, so a
 * pattern whose search time grows faster than the line stalls highlighting on one long line.
 *
 * The patterns are Oniguruma; each is translated to the JavaScript regex it reads as. A pattern the translation cannot
 * carry over is reported, never skipped.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { analyse } from "scslre";
import { describe, expect, it } from "vitest";

const SYNTAXES_DIR = path.resolve(__dirname, "..", "..", "..", "syntaxes");
const PATTERN_KEYS = new Set(["match", "begin", "end", "while"]);

const POSIX_CLASSES: Readonly<Record<string, string>> = {
    alnum: "a-zA-Z0-9",
    alpha: "a-zA-Z",
    blank: " \\t",
    digit: "0-9",
    lower: "a-z",
    space: " \\t\\n\\r\\f\\v",
    upper: "A-Z",
    word: "\\w",
    xdigit: "0-9a-fA-F",
};

/** Letter escapes JavaScript reads as Oniguruma does; any other (`\h`, `\A`, `\G`, `\z`, ...) means something else. */
const SHARED_LETTER_ESCAPES = new Set("bBdDfnrsStvwWux");

interface Pattern {
    readonly file: string;
    readonly source: string;
}

function collectPatterns(node: unknown, file: string, out: Pattern[]): void {
    if (Array.isArray(node)) {
        for (const item of node) collectPatterns(item, file, out);
        return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
        if (PATTERN_KEYS.has(key) && typeof value === "string") out.push({ file, source: value });
        else collectPatterns(value, file, out);
    }
}

function letterEscapes(source: string): string[] {
    const letters: string[] = [];
    for (let i = 0; i < source.length; i++) {
        if (source[i] !== "\\") continue;
        const next = source[i + 1] ?? "";
        if (/^[a-zA-Z]$/.test(next)) letters.push(next);
        i++;
    }
    return letters;
}

/**
 * The JavaScript regex an Oniguruma pattern reads as, for backtracking analysis. Case folding does not change which
 * quantifiers can trade characters, so an inline `(?i)` anywhere becomes the `i` flag.
 */
function toJavaScript(source: string): { readonly source: string; readonly flags: string } | string {
    const foreign = letterEscapes(source).filter((letter) => !SHARED_LETTER_ESCAPES.has(letter));
    if (foreign.length > 0) return `Oniguruma-only escape \\${foreign.join(", \\")}`;
    let js = source.replaceAll(/\[:([a-z]+):\]/g, (whole, name: string) => POSIX_CLASSES[name] ?? whole);
    if (js.includes("[:")) return "unknown POSIX class";
    const flags = js.includes("(?i") ? "i" : "";
    js = js.replaceAll("(?i)", "").replaceAll("(?i:", "(?:");
    try {
        return { source: new RegExp(js, flags).source, flags };
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

function findings(patterns: readonly Pattern[]): string[] {
    const out: string[] = [];
    for (const { file, source } of patterns) {
        const js = toJavaScript(source);
        if (typeof js === "string") {
            out.push(`${file}: ${source} -- cannot analyse: ${js}`);
            continue;
        }
        const { reports } = analyse(js);
        if (reports.length === 0) continue;
        const kinds = reports.map((report) => (report.exponential ? `${report.type} (exponential)` : report.type));
        out.push(`${file}: ${source} -- ${[...new Set(kinds)].join(", ")}`);
    }
    return out;
}

describe("syntaxes/*.tmLanguage.json patterns", () => {
    it("are analysed by the scslre the ReDoS lint uses", () => {
        const fromPlugin = createRequire(require.resolve("eslint-plugin-regexp"));
        const version = (request: (id: string) => unknown): unknown =>
            (request("scslre/package.json") as { version: unknown }).version;
        expect(version(require)).toBe(version(fromPlugin));
    });

    it("reports a known super-linear pattern", () => {
        expect(findings([{ file: "control", source: "\\[[^\\]]*\\]" }])).toEqual(["control: \\[[^\\]]*\\] -- Move"]);
    });

    it("all search in time linear in the line", () => {
        const patterns: Pattern[] = [];
        for (const file of fs.readdirSync(SYNTAXES_DIR).filter((name) => name.endsWith(".tmLanguage.json"))) {
            const grammar: unknown = JSON.parse(fs.readFileSync(path.join(SYNTAXES_DIR, file), "utf8"));
            collectPatterns(grammar, file, patterns);
        }
        const unique = [...new Map(patterns.map((p) => [`${p.file}\0${p.source}`, p])).values()];

        expect(findings(unique)).toEqual([]);
        // A walk that collected nothing analysed nothing.
        expect(unique.length).toBeGreaterThan(1000);
    });
});
