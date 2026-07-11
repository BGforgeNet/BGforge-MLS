/**
 * Island B consistency: the four LSP tree-sitter grammars are the authority for "what is a keyword".
 * This test keeps three hand-maintained lists from silently diverging from that authority:
 *   Edge 1  server/data/<lang>-base.yml `keywords:`  is a subset of the grammar's keyword tokens
 *   Edge 2  every literal captured in queries/highlights.scm is a real grammar token
 *   Edge 3  every grammar keyword appears somewhere in the TextMate grammar source
 *
 * All three are directional (grammar is authority) and stay green on the current tree; intentional gaps
 * live in per-grammar allowlists below with a technical rationale per entry.
 *
 * Authority = grammars/<id>/src/node-types.json (built by `pnpm build:grammar`, git-ignored). CI builds
 * grammars before tests so this always runs there; a fresh un-built local checkout skips cleanly.
 */
import { existsSync, readFileSync } from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const nodeTypesPath = (id: string) => path.join(ROOT, "grammars", id, "src", "node-types.json");
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

/** `- name:` entries under the top-level `keywords:` block of a data YAML file. */
function dataKeywords(file: string): string[] {
    const doc = parseYaml(readFileSync(dataPath(file), "utf8")) as {
        keywords?: { items?: { name: string }[] };
    };
    return (doc.keywords?.items ?? []).map((i) => i.name);
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
     * Whether `data.keywords` is genuinely a subset of the grammar's keyword tokens for this language.
     * true for fallout-ssl (7/7) and weidu-tp2 (4/4). false for weidu-baf and weidu-d, whose `keywords:`
     * completion list intentionally includes WeiDU scope/construct words (GLOBAL/LOCALS/MYAREA/...) that the
     * grammar parses as identifiers, not reserved tokens - so a subset check there would be mostly-allowlist.
     */
    checkDataSubset: boolean;
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
        checkDataSubset: true,
        caseInsensitive: true,
        textmateAbsenceAllow: {
            andalso:
                "short-circuit AND operator (grammar alias token); no TextMate keyword literal - pre-existing highlighting gap, not a regression",
            orelse: "short-circuit OR operator (grammar alias token); no TextMate keyword literal - pre-existing highlighting gap, not a regression",
        },
    },
    {
        id: "weidu-tp2",
        tm: "weidu-tp2.tmLanguage.yml",
        data: "weidu-tp2-base.yml",
        checkDataSubset: true,
        caseInsensitive: false,
        textmateAbsenceAllow: {
            // Bare tokens that only occur inside compound keywords the TextMate grammar already highlights whole.
            EXISTING:
                "only occurs within COPY_EXISTING / COPY_EXISTING_REGEXP, which TextMate highlights as whole compounds",
            FROM: "only occurs within DISABLE_FROM_KEY, which TextMate highlights as a whole compound",
            // Grammar-reserved tokens with no TextMate keyword literal - pre-existing highlighting gaps, not regressions.
            ABS: "grammar-reserved; no TextMate keyword literal - pre-existing highlighting gap",
            COMPONENT_IS_INSTALLED:
                "grammar-reserved predicate; no TextMate keyword literal - pre-existing highlighting gap",
            EQUALS: "grammar-reserved predicate; no TextMate keyword literal - pre-existing highlighting gap",
            FORBID_PREDICATE: "grammar-reserved; no TextMate keyword literal - pre-existing highlighting gap",
            KEEP_CRLF: "grammar-reserved; no TextMate keyword literal - pre-existing highlighting gap",
            MANAGED: "grammar-reserved; no TextMate keyword literal - pre-existing highlighting gap",
            NULL: "grammar-reserved; no TextMate keyword literal - pre-existing highlighting gap",
            TITLE: "grammar-reserved; no TextMate keyword literal - pre-existing highlighting gap",
        },
    },
    {
        id: "weidu-baf",
        tm: "weidu-baf.tmLanguage.yml",
        data: "weidu-baf-base.yml",
        // data.keywords includes WeiDU scope words (GLOBAL/LOCALS/MYAREA) parsed as identifiers, not tokens.
        checkDataSubset: false,
        caseInsensitive: false,
        textmateAbsenceAllow: {},
    },
    {
        id: "weidu-d",
        tm: "weidu-d.tmLanguage.yml",
        data: "weidu-d-base.yml",
        // data.keywords includes GLOBAL/LOCALS/MYAREA/nonPausing/OR/RESPONSE, none of which are grammar tokens.
        checkDataSubset: false,
        caseInsensitive: false,
        textmateAbsenceAllow: {
            I_C_T: "WeiDU dialog action shorthand (I_C_T / I_C_T2-4); no standalone TextMate keyword literal - pre-existing highlighting gap, not a regression",
        },
    },
];

const ARTIFACTS_BUILT = GRAMMARS.every((g) => existsSync(nodeTypesPath(g.id)));

describe.skipIf(!ARTIFACTS_BUILT)("grammar keyword sync (Island B)", () => {
    describe("Edge 1: data `keywords:` is a subset of grammar tokens", () => {
        const applicable = GRAMMARS.filter((g) => g.checkDataSubset);
        it.each(applicable)("$id: every data keyword is a real grammar token", (g) => {
            const tokens = grammarAnonTokens(g.id);
            const bogus = dataKeywords(g.data).filter((kw) => !tokens.has(kw));
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
