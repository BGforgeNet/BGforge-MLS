/**
 * Differential: the bundled reference compiler is the authority on what SSL syntax is legal, so constructs the
 * grammar claims (or refuses) are checked against it rather than against our own reading of its source. A
 * divergence in either direction is a defect:
 *   - the compiler accepts, we reject  -> a false "Syntax error" on valid source
 *   - we accept, the compiler rejects  -> a keyword read as a name, or an operator the language does not have
 *
 * A construct no script in the corpus uses is invisible to the corpus sweep but is still source a user can write,
 * which is how `import procedure`, `call .. when` and the paren-less `for` went unnoticed.
 *
 * Siblings: weidu-tp2-grammar-differential.test.ts and weidu-d-grammar-differential.test.ts do the same against
 * the WeiDU binary.
 */

import { execFile } from "child_process";
import { createRequire } from "module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initParser, parseWithCache } from "@bgforge/shared/parsers/fallout-ssl";

/** A grammar.json rule, as far as the reserved-word set nests: TOKEN > PREC > PATTERN. */
interface GrammarRule {
    type: string;
    value?: unknown;
    content?: GrammarRule;
}

/** The keyword a case-insensitive keyword token spells: its pattern is one `[xX]` class per letter. */
function keywordOf(rule: GrammarRule): string {
    let node: GrammarRule | undefined = rule;
    while (node && node.type !== "PATTERN") node = node.content;
    expect(node, `reserved rule ${JSON.stringify(rule)} has no pattern`).toBeDefined();
    return String(node!.value).replaceAll(/\[(.).\]/g, "$1");
}

/**
 * The words the grammar reserves, read from the generated grammar.json: its `reserved` set is RESERVED_WORDS in
 * grammar.js. Not skipped when absent - this suite needs a built grammar anyway.
 */
const GRAMMAR_RESERVED_WORDS = (
    (
        JSON.parse(readFileSync(path.resolve(__dirname, "../../../grammars/fallout-ssl/src/grammar.json"), "utf8")) as {
            reserved?: { global?: GrammarRule[] };
        }
    ).reserved?.global ?? []
).map((rule) => keywordOf(rule));

/**
 * Words the reference compiler always lexes as keywords but the grammar leaves unreserved. Each case below checks
 * the compiler's side only; grammar.js says why each one stays a name.
 */
const UNRESERVED_KEYWORDS = ["wait", "include"];

const reference = createRequire(path.resolve(__dirname, "../../package.json")).resolve(
    "sslc-emscripten-noderawfs/compiler.mjs",
);

/** A statement in a procedure body. */
const stmt = (body: string) => `procedure start begin\n  ${body}\nend\n`;

interface Case {
    name: string;
    code: string;
    /** Assert the compiler's verdict only: a recorded divergence of the grammar, documented where it is decided. */
    referenceOnly?: boolean;
    /** The verdict the compiler must give, so a case cannot pass for the wrong reason. */
    expect: "accept" | "refuse";
}

const CASES: Case[] = [
    // Controls: a template mistake would otherwise read as every construct being broken.
    { name: "control: valid script", code: stmt('display_msg("hi");'), expect: "accept" },
    { name: "control: garbage", code: stmt("!!! ???"), expect: "refuse" },

    // Every reserved word, in the one slot that takes a bare name: the compiler rejects each.
    ...GRAMMAR_RESERVED_WORDS.map((word) => ({
        name: `reserved word ${word} is not a variable name`,
        code: `variable ${word};\n`,
        expect: "refuse" as const,
    })),
    ...GRAMMAR_RESERVED_WORDS.map((word) => ({
        name: `reserved word ${word.toUpperCase()} is not a variable name either`,
        code: `variable ${word.toUpperCase()};\n`,
        expect: "refuse" as const,
    })),
    ...UNRESERVED_KEYWORDS.map((word) => ({
        name: `unreserved keyword ${word} is still a keyword to the compiler`,
        code: `variable ${word};\n`,
        expect: "refuse" as const,
        referenceOnly: true,
    })),
    { name: "a keyword cannot stand for a value", code: stmt("variable a; a := then;"), expect: "refuse" },

    // `in` is not an operator: only `call`, `procedure` headers and `foreach` take it.
    { name: "in is not a membership operator", code: stmt("variable a; if 1 in a then a := 1;"), expect: "refuse" },

    // Comparisons do not chain: the compiler takes one comparison per operand pair. The grammar groups a chain
    // rather than rejecting it, a recorded divergence (see binary_expr in grammar.js).
    {
        name: "comparisons do not chain",
        code: stmt("variable a; a := 1 < 2 < 3;"),
        expect: "refuse",
        referenceOnly: true,
    },
];

const execFileAsync = promisify(execFile);

/** Each run is a short single-threaded process; a hang is caught by this bound, not by the suite. */
const REFERENCE_TIMEOUT_MS = 60_000;

/** Concurrent reference runs. */
const POOL = 4;

let tmpDir = "";
const verdicts = new Map<string, "accept" | "refuse">();

/**
 * The compiler's verdict: whether it wrote the output file. `-p` puts its preprocessor in the path, as a real
 * build does: without it a `#define` is not expanded and a multi-line string is not refused.
 */
async function referenceVerdict(code: string, slug: string): Promise<"accept" | "refuse"> {
    // A directory per case: the compiler keeps scratch files in its working directory, so two runs sharing one
    // corrupt each other's verdicts.
    const dir = path.join(tmpDir, slug);
    mkdirSync(dir);
    writeFileSync(path.join(dir, "case.ssl"), code);
    const out = path.join(dir, "case.int");
    try {
        await execFileAsync(process.execPath, [reference, "-q", "-p", "-O0", "case.ssl", "-o", out], {
            cwd: dir,
            timeout: REFERENCE_TIMEOUT_MS,
        });
    } catch {
        // A refusal exits non-zero; the verdict is read off the output file either way.
    }
    return existsSync(out) ? "accept" : "refuse";
}

async function computeVerdicts(): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < CASES.length) {
            const index = next++;
            const { name, code } = CASES[index]!;
            // oxlint-disable-next-line no-await-in-loop -- each worker runs its cases one at a time; the pool is the parallelism
            verdicts.set(name, await referenceVerdict(code, `case${index}`));
        }
    };
    await Promise.all(Array.from({ length: POOL }, worker));
}

/** Our grammar's verdict: any ERROR or MISSING node means we reject the snippet. */
function grammarVerdict(code: string): "accept" | "refuse" {
    const tree = parseWithCache(code);
    expect(tree, "parser returned no tree").not.toBeNull();
    return tree!.rootNode.hasError ? "refuse" : "accept";
}

beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "ssl-grammar-differential-"));
    await initParser();
    await computeVerdicts();
}, REFERENCE_TIMEOUT_MS * 4);

afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("Fallout SSL differential (grammar vs the reference compiler)", () => {
    it("has a case for every construct, each named once", () => {
        expect(GRAMMAR_RESERVED_WORDS.length).toBeGreaterThan(0);
        expect(new Set(CASES.map((c) => c.name)).size).toBe(CASES.length);
    });

    it.each(CASES)("$name: the compiler gives the expected verdict", ({ name, expect: expected }) => {
        expect(verdicts.get(name)).toBe(expected);
    });

    it.each(CASES.filter((c) => !c.referenceOnly))("$name: our grammar agrees", ({ name, code }) => {
        expect(grammarVerdict(code), `the reference compiler's verdict is ${verdicts.get(name)}`).toBe(
            verdicts.get(name),
        );
    });
});
