/**
 * Validates WeiDU D TextMate scopes against actual tokenization, focused on embedded-BAF delegation.
 * The D grammar delegates trigger/action string bodies to source.weidu-baf, so the registry resolves
 * both grammars.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseRawGrammar, Registry, type IGrammar, type IRawGrammar, INITIAL } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";

const D_SYNTAX_PATH = path.resolve(__dirname, "../../../syntaxes/weidu-d.tmLanguage.json");
const BAF_SYNTAX_PATH = path.resolve(__dirname, "../../../syntaxes/weidu-baf.tmLanguage.json");
const ONIG_WASM_PATH = path.resolve(__dirname, "../../../node_modules/vscode-oniguruma/release/onig.wasm");

let grammar: IGrammar;

function getTokenScopes(text: string, lineNumber: number, target: string): readonly string[] {
    const lines = text.split("\n");
    let ruleStack = INITIAL;

    for (let index = 0; index <= lineNumber; index += 1) {
        const line = lines[index] ?? "";
        const tokenized = grammar.tokenizeLine(line, ruleStack);
        ruleStack = tokenized.ruleStack;

        if (index !== lineNumber) {
            continue;
        }

        const startIndex = line.indexOf(target);
        expect(startIndex).toBeGreaterThanOrEqual(0);
        const endIndex = startIndex + target.length;
        const token = tokenized.tokens.find(
            ({ startIndex: tokenStart, endIndex: tokenEnd }) => tokenStart <= startIndex && tokenEnd >= endIndex,
        );
        expect(token).toBeDefined();
        return token!.scopes;
    }

    throw new Error(`Line ${lineNumber} not found`);
}

beforeAll(async () => {
    await loadWASM(readFileSync(ONIG_WASM_PATH).buffer);

    const registry = new Registry({
        onigLib: Promise.resolve({
            createOnigScanner(patterns: string[]) {
                return new OnigScanner(patterns);
            },
            createOnigString(text: string) {
                return new OnigString(text);
            },
        }),
        loadGrammar: async (scopeName) => {
            if (scopeName === "source.weidu-d") {
                return parseRawGrammar(readFileSync(D_SYNTAX_PATH, "utf-8"), D_SYNTAX_PATH) as IRawGrammar;
            }
            if (scopeName === "source.weidu-baf") {
                return parseRawGrammar(readFileSync(BAF_SYNTAX_PATH, "utf-8"), BAF_SYNTAX_PATH) as IRawGrammar;
            }
            return null;
        },
    });

    grammar = (await registry.loadGrammar("source.weidu-d"))!;
});

describe("weidu-d TextMate syntax - embedded BAF delegation", () => {
    it("colors a plain IF trigger body as an embedded condition (baseline)", () => {
        const scopes = getTokenScopes("IF ~Dead(Myself)~ THEN", 0, "Dead");
        expect(scopes).toContain("meta.weidu-d.condition");
    });

    it("colors a WEIGHT-guarded IF trigger body as an embedded condition", () => {
        // Regression guard: before the fix the condition begin required IF immediately before ~, so
        // `IF WEIGHT #5 ~...~` fell through to the plain string rule and lost BAF delegation.
        const scopes = getTokenScopes("IF WEIGHT #5 ~Dead(Myself)~ THEN", 0, "Dead");
        expect(scopes).toContain("meta.weidu-d.condition");
    });
});
