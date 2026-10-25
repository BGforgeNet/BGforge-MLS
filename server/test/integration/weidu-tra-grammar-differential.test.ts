/**
 * Differential: the WeiDU binary is the authority on what a `.tra` file may hold, so every form the grammar
 * claims is checked against the installer's own reader (`--make-tlk`) rather than against our reading of the
 * docs. A divergence in either direction is a defect:
 *   - WeiDU accepts, we reject  -> a false "Syntax error" on valid syntax
 *   - we accept, WeiDU rejects  -> a real error the user never sees flagged
 *
 * `--parse-check` has no `.tra` type, and `--make-tlk` exits 0 whether it read the file or not, so the verdict
 * is its output: "has N translation strings" for a file it read, a parse or lexer error for one it refused.
 *
 * A divergence we keep carries a `divergence` note and the case asserts the disagreement STILL HOLDS. Siblings:
 * weidu-d-grammar-differential.test.ts and weidu-tp2-grammar-differential.test.ts; all three find their binary
 * through weidu-binary.ts, which has no skip path.
 */

import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveWeidu, WEIDU_HOOK_TIMEOUT_MS, WEIDU_TIMEOUT_MS } from "../../../scripts/utils/src/weidu-binary.ts";
import { initParser, parseWithCache } from "@bgforge/shared/parsers/weidu-tra";

interface Case {
    name: string;
    code: string;
    /** Set only where we KNOWINGLY disagree with WeiDU. */
    divergence?: string;
}

const CASES: Case[] = [
    // Controls: without them a template mistake reads as every construct being broken.
    { name: "control: a minimal entry parses", code: "@1 = ~x~\n" },
    { name: "control: an entry without = is rejected", code: "@1 ~x~\n" },

    // Strings.
    { name: "tilde string", code: "@1 = ~x~\n" },
    { name: "double-quoted string", code: '@1 = "x"\n' },
    { name: "percent string", code: "@1 = %x%\n" },
    { name: "percent string with a space", code: "@1 = %a b%\n" },
    { name: "five-tilde string holding tildes", code: "@1 = ~~~~~a ~ b ~~ c~~~~~\n" },
    { name: "empty tilde string", code: "@1 = ~~\n" },
    { name: "empty five-tilde string", code: "@1 = ~~~~~~~~~~\n" },
    { name: "four tildes are two strings", code: "@1 = ~~~~\n" },
    { name: "multi-line tilde string", code: "@1 = ~a\nb~\n" },
    { name: "multi-line double-quoted string", code: '@1 = "a\nb"\n' },
    { name: "multi-line percent string", code: "@1 = %a\nb%\n" },
    { name: "a quote inside a tilde string", code: '@1 = ~say "hi"~\n' },
    { name: "a tilde inside a double-quoted string", code: '@1 = "a ~ b"\n' },
    { name: "an entry written inside a string", code: '@1 = "has\n@9 = ~x~ inside"\n@2 = ~y~\n' },
    { name: "a backslash is no escape", code: '@1 = "path\\"\n@2 = ~x~\n' },
    { name: "bare word", code: "@1 = bareword\n" },
    { name: "bare word with dots, dashes and hashes", code: "@1 = Hello_World-1.2#x\n" },
    { name: "a bare number", code: "@1 = 5\n" },
    { name: "concatenation", code: "@1 = ~a~ ^ ~b~\n" },
    { name: "concatenation of every form", code: '@1 = ~a~ ^ bare ^ "c" ^ %d%\n' },
    { name: "concatenation with nothing after ^ is rejected", code: "@1 = ~a~ ^\n" },
    { name: "concatenation with nothing before ^ is rejected", code: "@1 = ^ ~a~\n" },

    // Sounds and the female string.
    { name: "sound", code: "@1 = ~a~ [SND]\n" },
    { name: "sound with a space and a hash", code: "@1 = ~a~ [XAN 23]\n@2 = ~b~ [X#BLANK]\n" },
    { name: "male and female strings", code: "@1 = ~a~ ~b~\n" },
    { name: "a sound after each string", code: "@1 = ~a~ [S1] ~b~ [S2]\n" },
    { name: "a sound then a bare word", code: "@1 = ~a~ [SND]ND\n" },
    { name: "three strings are rejected", code: "@1 = ~a~ ~b~ ~c~\n" },
    { name: "two sounds in a row are rejected", code: "@1 = ~a~ [S] [T]\n" },
    {
        name: "a sound spanning lines is accepted by WeiDU only",
        code: "@1 = ~a~ [S\nND]\n",
        divergence:
            "WeiDU reads a sound across a line break. The grammar ends it at the line, so an unclosed bracket " +
            "being typed fails there instead of consuming the entries below.",
    },

    // The value of an entry that names another string.
    { name: "#N TLK reference", code: "@1 = #5\n" },
    { name: "negative #N TLK reference", code: "@1 = #-5\n" },
    { name: "@N reference to an entry", code: "@1 = ~one~\n@2 = @1\n" },
    { name: "@N reference to an entry below", code: "@1 = @2\n@2 = ~x~\n" },
    { name: "(AT string)", code: "@1 = (AT ~x~)\n" },

    // Entry numbers.
    { name: "negative entry number", code: "@-5 = ~x~\n" },
    { name: "leading zero entry number", code: "@01 = ~x~\n" },
    { name: "no space around =", code: "@1=~x~\n" },
    { name: "duplicate entry numbers", code: "@1 = ~a~\n@1 = ~b~\n" },
    { name: "symbolic entry name is rejected", code: "@NAME = ~x~\n" },
    { name: "an entry with no value is rejected", code: "@1 =\n@2 = ~x~\n" },
    {
        name: "a space between @ and the number is accepted by us only",
        code: "@ 1 = ~x~\n",
        divergence:
            "WeiDU rejects the gap, the formatter removes it, and a typed gap is reported by the formatter's " +
            "effect instead of a second diagnostic for an entry that is otherwise clear.",
    },

    // Comments.
    { name: "line comment", code: "// note\n@1 = ~x~\n" },
    { name: "block comment", code: "/* note */\n@1 = ~x~\n" },
    { name: "empty block comment", code: "/**/@1 = ~x~\n" },
    { name: "nested block comment", code: "/* a /* b */ c */\n@1 = ~x~\n" },
    { name: "block comment inside an entry", code: "@1 = ~a~ /* c */ [S]\n" },
    { name: "an entry inside a block comment", code: "/* @1 = ~a~ */\n@2 = ~b~\n" },
    { name: "a trailing line comment holding a delimiter", code: '@1 = ~a~ // 100% "done" ~\n@2 = ~b~\n' },
    { name: "comment markers inside a string", code: "@1 = ~a // b /* c~\n" },
    { name: "an unclosed block comment is rejected", code: "@1 = ~x~\n/* oops\n@2 = ~y~\n" },
    { name: "a stray closing marker is rejected", code: "@1 = ~x~\n*/\n" },

    // Unclosed strings, which WeiDU refuses.
    { name: "an unclosed tilde string is rejected", code: "@1 = ~x\n" },
    { name: "an unclosed double quote is rejected", code: '@1 = "x\n@2 = ~y~\n' },
    { name: "an unclosed percent string is rejected", code: "@1 = %x\n@2 = ~y~\n" },

    // Reserved words of the shared lexer.
    {
        name: "a bare word that is a D keyword is accepted by us only",
        code: "@1 = BEGIN\n",
        divergence:
            "WeiDU lexes its dialogue keywords as keywords even in a .tra file, so it refuses them as a bare " +
            "word. Nobody writes one, and the grammar does not carry the dialogue keyword list.",
    },
];

let weidu = "";
let tmpDir = "";

interface WeiduVerdict {
    accepts: boolean;
    /** Set when WeiDU gave no usable verdict, so the case is reported rather than silently passed. */
    inconclusive?: string;
}

function weiduVerdict(code: string, slug: string): WeiduVerdict {
    const source = path.join(tmpDir, `${slug}.tra`);
    writeFileSync(source, code);
    const result = spawnSync(
        weidu,
        ["--nogame", "--noautoupdate", "--tlkout", path.join(tmpDir, `${slug}.tlk`), "--make-tlk", source],
        { cwd: tmpDir, timeout: WEIDU_TIMEOUT_MS, encoding: "utf8" },
    );
    if (result.error) return { accepts: false, inconclusive: result.error.message };
    const output = `${result.stdout}${result.stderr}`;
    if (/has \d+ translation strings/.test(output)) return { accepts: true };
    if (/PARSE ERROR|LEXER ERROR|Parse_error|Lexer/.test(output)) return { accepts: false };
    return { accepts: false, inconclusive: `no verdict in WeiDU output: ${output.slice(-300)}` };
}

/** Our grammar's verdict: any ERROR or MISSING node in the tree means we reject the file. */
function grammarAccepts(code: string): boolean {
    const tree = parseWithCache(code);
    expect(tree, "parser returned no tree").not.toBeNull();
    return !tree!.rootNode.hasError;
}

beforeAll(async () => {
    weidu = resolveWeidu();
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "weidu-tra-differential-"));
    await initParser();
}, WEIDU_HOOK_TIMEOUT_MS);

afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("WeiDU TRA differential (grammar vs the real binary)", () => {
    it("has a WeiDU binary and a case for every form under test", () => {
        expect(weidu).not.toBe("");
        expect(CASES.length).toBeGreaterThan(0);
        // Case names are the failure labels, so a duplicate would silently hide one of the two.
        expect(new Set(CASES.map((c) => c.name)).size).toBe(CASES.length);
    });

    it.each(CASES)("$name: our grammar agrees with WeiDU", ({ name, code, divergence }) => {
        const slug = name.replaceAll(/[^a-z0-9]+/gi, "_");
        const verdict = weiduVerdict(code, slug);
        // An inconclusive WeiDU run is reported, never folded into "reject".
        expect(verdict.inconclusive, `WeiDU gave no verdict for "${name}"`).toBeUndefined();

        // A recorded divergence expects the OPPOSITE verdict; every other case expects agreement.
        const expected = divergence === undefined ? verdict.accepts : !verdict.accepts;
        const disagree = verdict.accepts
            ? "WeiDU accepts this but our grammar reports a syntax error"
            : "WeiDU rejects this but our grammar accepts it";
        const message =
            divergence === undefined
                ? disagree
                : `This case is recorded as a deliberate divergence, but the two now agree. ${divergence}`;

        expect(grammarAccepts(code), message).toBe(expected);
    });
});
