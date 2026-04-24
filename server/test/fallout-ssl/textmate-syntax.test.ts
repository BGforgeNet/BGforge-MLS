/**
 * Validates Fallout SSL TextMate scopes against actual tokenization.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseRawGrammar, Registry, type IGrammar, type IRawGrammar, INITIAL } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";

const SYNTAX_PATH = path.resolve(__dirname, "../../../syntaxes/fallout-ssl.tmLanguage.json");
const TOOLTIP_SYNTAX_PATH = path.resolve(__dirname, "../../../syntaxes/fallout-ssl-tooltip.tmLanguage.json");
const ONIG_WASM_PATH = path.resolve(__dirname, "../../../node_modules/vscode-oniguruma/release/onig.wasm");

let grammar: IGrammar;
let tooltipGrammar: IGrammar;

function getTokenScopes(grammarToUse: IGrammar, text: string, lineNumber: number, target: string): readonly string[] {
    const lines = text.split("\n");
    let ruleStack = INITIAL;

    for (let index = 0; index <= lineNumber; index += 1) {
        const line = lines[index] ?? "";
        const tokenized = grammarToUse.tokenizeLine(line, ruleStack);
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
            if (scopeName === "source.fallout-ssl") {
                const rawGrammar = parseRawGrammar(readFileSync(SYNTAX_PATH, "utf-8"), SYNTAX_PATH) as IRawGrammar;
                return rawGrammar;
            }
            if (scopeName === "source.fallout-ssl-tooltip") {
                const rawGrammar = parseRawGrammar(
                    readFileSync(TOOLTIP_SYNTAX_PATH, "utf-8"),
                    TOOLTIP_SYNTAX_PATH,
                ) as IRawGrammar;
                return rawGrammar;
            }
            return null;
        },
    });

    grammar = await registry.loadGrammar("source.fallout-ssl");
    tooltipGrammar = await registry.loadGrammar("source.fallout-ssl-tooltip");
});

describe("fallout-ssl TextMate syntax", () => {
    it("colors procedure parameter names in signatures as variable parameters", () => {
        const text = "procedure is_human(variable who) begin";
        const scopes = getTokenScopes(grammar, text, 0, "who");

        expect(scopes).toContain("variable.parameter.fallout-ssl");
    });

    it("does not color local variable names declared in procedure bodies as variable parameters", () => {
        const text = ["procedure is_human(variable who) begin", "   variable type;", "end"].join("\n");
        const scopes = getTokenScopes(grammar, text, 1, "type");

        expect(scopes).not.toContain("variable.parameter.fallout-ssl");
        expect(scopes).not.toContain("entity.name.function.fallout-ssl");
        expect(scopes).not.toContain("entity.name.function.fallout-ssl.macro");
    });

    it("treats object-like macros with parenthesized replacement text as normal defines", () => {
        const text = "#define CUR_AREA_MILITARY_BASE            (cur_town == AREA_MILITARY_BASE)";
        const nameScopes = getTokenScopes(grammar, text, 0, "CUR_AREA_MILITARY_BASE");
        const firstExprScopes = getTokenScopes(grammar, text, 0, "cur_town");
        const secondExprScopes = getTokenScopes(grammar, text, 0, "AREA_MILITARY_BASE");

        expect(nameScopes).not.toContain("entity.name.function.fallout-ssl.macro");
        expect(firstExprScopes).not.toContain("variable.parameter.fallout-ssl");
        expect(secondExprScopes).not.toContain("variable.parameter.fallout-ssl");
    });

    it("colors parameterized macro names and parameters", () => {
        const text = "#define SCALE(value, factor)";
        const nameScopes = getTokenScopes(grammar, text, 0, "SCALE");
        const valueScopes = getTokenScopes(grammar, text, 0, "value");
        const factorScopes = getTokenScopes(grammar, text, 0, "factor");

        expect(nameScopes).toContain("entity.name.function.fallout-ssl.macro");
        expect(valueScopes).toContain("variable.parameter.fallout-ssl");
        expect(factorScopes).toContain("variable.parameter.fallout-ssl");
    });

    it("colors tooltip procedure keyword as procedure type, not control keyword", () => {
        const text = "procedure map_exit_p_proc";
        const scopes = getTokenScopes(tooltipGrammar, text, 0, "procedure");

        expect(scopes).toContain("support.type.fallout-ssl.procedure");
        expect(scopes).not.toContain("keyword.control.fallout-ssl-tooltip");
    });
});
