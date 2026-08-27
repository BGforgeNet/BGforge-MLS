/**
 * TextMate-vs-real-corpus sweep for the WeiDU D patch commands.
 *
 * The patch commands (ADD_STATE_TRIGGER and friends) carry their trigger/action as a bare tilde-string, and
 * each grammar rule has to count the arguments the command's own syntax puts before it. Getting that count
 * wrong fails SILENTLY: the body renders as an ordinary string, which is exactly what it did before the rules
 * existed, so no error surfaces and no unit test on a hand-written line necessarily notices. The corpus is the
 * oracle - across ~1000 real commands, every live one must delegate its body to source.weidu-baf.
 *
 * The unit-level scope assertions live in `server/test/weidu-d/textmate-syntax.test.ts`; this pins coverage
 * against argument shapes nobody wrote a fixture for.
 *
 * Requires external repos (`pnpm test:integration`, which needs `pnpm test:external` first).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import * as fg from "fast-glob";
import { beforeAll, describe, expect, it } from "vitest";
import { parseRawGrammar, Registry, type IGrammar, INITIAL } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { IE_FIXTURES } from "./test-helpers";

const ROOT = path.resolve(__dirname, "../../..");
const D_SYNTAX_PATH = path.join(ROOT, "syntaxes/weidu-d.tmLanguage.json");
const BAF_SYNTAX_PATH = path.join(ROOT, "syntaxes/weidu-baf.tmLanguage.json");
const ONIG_WASM_PATH = path.join(ROOT, "node_modules/vscode-oniguruma/release/onig.wasm");

/** Commands whose trigger/action body must reach the BAF grammar. */
const PATCH_COMMAND =
    /^\s*(?:ADD_STATE_TRIGGER|ADD_TRANS_TRIGGER|REPLACE_STATE_TRIGGER|REPLACE_TRANS_TRIGGER|ADD_TRANS_ACTION|REPLACE_TRANS_ACTION)\b/i;

/** The command keyword itself carries this scope, so it is not evidence that the BODY delegated. */
const KEYWORD_SCOPE = "support.function.weidu-baf.action";

let grammar: IGrammar;

beforeAll(async () => {
    await loadWASM(readFileSync(ONIG_WASM_PATH).buffer);
    const registry = new Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
            createOnigString: (text: string) => new OnigString(text),
        }),
        loadGrammar: async (scopeName) => {
            if (scopeName === "source.weidu-d") {
                return parseRawGrammar(readFileSync(D_SYNTAX_PATH, "utf-8"), D_SYNTAX_PATH);
            }
            if (scopeName === "source.weidu-baf") {
                return parseRawGrammar(readFileSync(BAF_SYNTAX_PATH, "utf-8"), BAF_SYNTAX_PATH);
            }
            return null;
        },
    });
    grammar = (await registry.loadGrammar("source.weidu-d"))!;
});

const files = fg.sync("**/*.d", { cwd: IE_FIXTURES, absolute: true, caseSensitiveMatch: false });

interface Sweep {
    /** Commands whose body reached the BAF grammar. */
    delegated: number;
    /** Commands with no body string at all - ADD_TRANS_ACTION's is optional. */
    noBody: number;
    /** Commands inside a block comment, which correctly delegate nothing. */
    commented: number;
    /** Commands that carry a body the BAF grammar never saw - the failure this suite exists for. */
    misses: string[];
}

function sweep(): Sweep {
    const out: Sweep = { delegated: 0, noBody: 0, commented: 0, misses: [] };
    for (const file of files) {
        // latin1: the corpus predates UTF-8 and a decode error must not abort the sweep. Only ASCII keywords
        // and scope names are inspected, so the exact legacy codepage does not matter here.
        const text = readFileSync(file, "latin1");
        // The rule stack carries across lines on purpose - a command inside an unterminated block comment is
        // only recognisable as such from the preceding lines.
        let stack = INITIAL;
        for (const line of text.split(/\r?\n/)) {
            const isCommand = PATCH_COMMAND.test(line);
            const { tokens, ruleStack } = grammar.tokenizeLine(line, stack);
            stack = ruleStack;
            if (!isCommand) continue;
            if (tokens.some((t) => t.scopes.some((s) => s.startsWith("comment.")))) {
                out.commented++;
                continue;
            }
            if (tokens.some((t) => t.scopes.some((s) => s.endsWith(".weidu-baf") && s !== KEYWORD_SCOPE))) {
                out.delegated++;
                continue;
            }
            // Strip the command and its tilde-quoted filename; a body string is whatever tilde-pair is left.
            const afterFilename = line.replace(/^\s*\w+\s+~[^~]*~/, "");
            if (/~[^~\s][^~]*~/.test(afterFilename)) out.misses.push(`${path.basename(file)}: ${line.trim()}`);
            else out.noBody++;
        }
    }
    return out;
}

describe.skipIf(files.length === 0)("weidu-d TextMate patch commands over the real corpus", () => {
    it("delegates every live command's body to the BAF grammar", () => {
        const result = sweep();

        expect(result.misses).toEqual([]);
        // Guards the guard: if the corpus or the keyword list ever stopped matching, every counter would go to
        // zero and an empty `misses` would pass vacuously.
        expect(result.delegated).toBeGreaterThan(900);
    });
});
