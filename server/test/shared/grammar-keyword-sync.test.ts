/**
 * Island B consistency: the four LSP tree-sitter grammars are the authority for "what is a keyword".
 * This test keeps three hand-maintained lists from silently diverging from that authority:
 *   Edge 1  the documented name blocks of server/data/<lang>-base.yml are a subset of the grammar's tokens
 *   Edge 2  every literal captured in queries/highlights.scm is a real grammar token
 *   Edge 3  every grammar keyword appears somewhere in the TextMate grammar source
 *
 * All three are directional (grammar is authority) and stay green on the current tree; intentional gaps
 * live in per-grammar allowlists below with a technical rationale per entry.
 *
 * Authority = the generated files under grammars/<id>/src/ (built by `pnpm build:grammar`, git-ignored):
 * grammar.json for Edge 1 (which tokens exist), node-types.json for Edges 2-3 (which appear as tree nodes).
 * CI builds grammars before tests so this always runs there; a fresh un-built local checkout skips cleanly.
 */
import { existsSync, readFileSync } from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const nodeTypesPath = (id: string) => path.join(ROOT, "grammars", id, "src", "node-types.json");
const grammarJsonPath = (id: string) => path.join(ROOT, "grammars", id, "src", "grammar.json");
const scmPath = (id: string) => path.join(ROOT, "grammars", id, "queries", "highlights.scm");
const tmPath = (file: string) => path.join(ROOT, "syntaxes", file);
const dataPath = (file: string) => path.join(ROOT, "server", "data", file);

interface NodeType {
    type: string;
    named: boolean;
}

/** Every anonymous (literal) token the compiled parser recognizes: keywords, operators, punctuation, #directives. */
function grammarAnonTokens(id: string): Set<string> {
    const nodes = JSON.parse(readFileSync(nodeTypesPath(id), "utf8")) as NodeType[];
    return new Set(nodes.filter((n) => !n.named).map((n) => n.type));
}

/** Alphabetic anonymous tokens = language keywords (drops operators / punctuation / #directives). */
function grammarKeywords(id: string): string[] {
    return [...grammarAnonTokens(id)].filter((t) => /^[A-Za-z_]+$/.test(t)).sort();
}

/**
 * Every token the grammar recognizes, as the union of two views - neither alone is complete:
 * node-types.json misses a rule whose entire body is one literal (`no_log_record_flag: () => "NO_LOG_RECORD"`,
 * which yields no anonymous node type), and grammar.json's STRING literals miss a token built from a pattern
 * (fallout-ssl's case-insensitive `procedure`). Checking against either alone makes Edge 1 fire on a keyword
 * the grammar handles fine. Edges 2 and 3 stay on node-types.json - they ask which tokens appear as tree
 * nodes, which is a different question.
 */
function grammarTokens(id: string): Set<string> {
    const tokens = new Set<string>(grammarAnonTokens(id));
    const walk = (node: unknown): void => {
        if (node === null || typeof node !== "object") return;
        if (Array.isArray(node)) {
            node.forEach((item) => walk(item));
            return;
        }
        const rule = node as { type?: string; value?: unknown };
        if (rule.type === "STRING" && typeof rule.value === "string") tokens.add(rule.value);
        Object.values(node).forEach((value) => walk(value));
    };
    walk(JSON.parse(readFileSync(grammarJsonPath(id), "utf8")).rules);
    return tokens;
}

/** `- name:` entries under one top-level block of a data YAML file. */
function dataBlockNames(file: string, block: string): string[] {
    const doc = parseYaml(readFileSync(dataPath(file), "utf8")) as Record<
        string,
        { items?: { name: string }[] } | undefined
    >;
    return (doc[block]?.items ?? []).map((i) => i.name);
}

/** Quoted literals captured in highlights.scm, e.g. `"while" @keyword` -> `while`. Named-node captures are skipped. */
function scmCapturedLiterals(id: string): string[] {
    const scm = readFileSync(scmPath(id), "utf8");
    return [...scm.matchAll(/^\s*"([^"]+)"\s+@/gm)].map((m) => m[1]!);
}

function escapeRegex(s: string): string {
    return s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word presence of `word` anywhere in the TextMate grammar source.
 * Fallout SSL is case-insensitive (its TextMate patterns use `(?i)`); the WeiDU grammars are case-sensitive.
 */
function presentInTextMate(word: string, tmSource: string, caseInsensitive: boolean): boolean {
    return new RegExp(`(?<![\\w])${escapeRegex(word)}(?![\\w])`, caseInsensitive ? "i" : "").test(tmSource);
}

interface GrammarCfg {
    id: string;
    tm: string;
    data: string;
    /**
     * Data blocks whose every entry must be a real grammar token. `keywords:` is the completion keyword list;
     * tp2 additionally documents its top-level directives under `flag:` and its component flags under
     * `component_flag:`. Those two are where drift hurts most: a directive documented and offered in
     * completion but absent from the grammar turns into a false "Syntax error" on every file that uses it.
     * Empty for weidu-baf and weidu-d, whose `keywords:` list intentionally includes WeiDU scope/construct
     * words (GLOBAL/LOCALS/MYAREA/...) that the grammar parses as identifiers, not reserved tokens - a subset
     * check there would be mostly-allowlist.
     */
    dataSubsetBlocks: readonly string[];
    /** Fallout SSL matches keywords case-insensitively; the WeiDU grammars are case-sensitive. Affects Edge 3 only. */
    caseInsensitive: boolean;
    /** Grammar keywords intentionally absent as TextMate literals (Edge 3). Key = keyword, value = why. */
    textmateAbsenceAllow: Record<string, string>;
}

const GRAMMARS: GrammarCfg[] = [
    {
        id: "fallout-ssl",
        tm: "fallout-ssl.tmLanguage.yml",
        data: "fallout-ssl-base.yml",
        dataSubsetBlocks: ["keywords"],
        caseInsensitive: true,
        textmateAbsenceAllow: {},
    },
    {
        id: "weidu-tp2",
        tm: "weidu-tp2.tmLanguage.yml",
        data: "weidu-tp2-base.yml",
        dataSubsetBlocks: ["keywords", "flag", "component_flag"],
        caseInsensitive: false,
        textmateAbsenceAllow: {},
    },
    {
        id: "weidu-baf",
        tm: "weidu-baf.tmLanguage.yml",
        data: "weidu-baf-base.yml",
        // data.keywords includes WeiDU scope words (GLOBAL/LOCALS/MYAREA) parsed as identifiers, not tokens.
        dataSubsetBlocks: [],
        caseInsensitive: false,
        textmateAbsenceAllow: {},
    },
    {
        id: "weidu-d",
        tm: "weidu-d.tmLanguage.yml",
        data: "weidu-d-base.yml",
        // data.keywords includes GLOBAL/LOCALS/MYAREA/nonPausing/OR/RESPONSE, none of which are grammar tokens.
        dataSubsetBlocks: [],
        caseInsensitive: false,
        textmateAbsenceAllow: {},
    },
];

const ARTIFACTS_BUILT = GRAMMARS.every((g) => existsSync(nodeTypesPath(g.id)));

describe.skipIf(!ARTIFACTS_BUILT)("grammar keyword sync (Island B)", () => {
    describe("Edge 1: documented keywords are a subset of grammar tokens", () => {
        const cases = GRAMMARS.flatMap((g) => g.dataSubsetBlocks.map((block) => ({ ...g, block })));
        it.each(cases)("$id: every name in data `$block:` is a real grammar token", (g) => {
            const tokens = grammarTokens(g.id);
            const bogus = dataBlockNames(g.data, g.block).filter((kw) => !tokens.has(kw));
            expect(bogus).toEqual([]);
        });
    });

    describe("Edge 2: highlights.scm literals resolve to real grammar tokens", () => {
        it.each(GRAMMARS)("$id: every captured literal is an anonymous grammar token", (g) => {
            const tokens = grammarAnonTokens(g.id);
            const dangling = scmCapturedLiterals(g.id).filter((lit) => !tokens.has(lit));
            expect(dangling).toEqual([]);
        });
    });

    describe("Edge 3: every grammar keyword appears in the TextMate grammar", () => {
        it.each(GRAMMARS)("$id: no grammar keyword is missing from TextMate highlighting", (g) => {
            const tmSource = readFileSync(tmPath(g.tm), "utf8");
            const missing = grammarKeywords(g.id).filter(
                (kw) => !presentInTextMate(kw, tmSource, g.caseInsensitive) && !(kw in g.textmateAbsenceAllow),
            );
            expect(missing).toEqual([]);
        });
    });
});
