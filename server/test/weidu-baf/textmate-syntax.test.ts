/**
 * Validates WeiDU BAF TextMate scopes against actual tokenization.
 *
 * These are pinning tests for the grammar's scope contract: IDS constants resolve to
 * constant.other.weidu-baf, trigger and action names to their function scopes. They exist because the
 * grammar's IDS vocabulary is being replaced by a casing rule - the colours must not move.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseRawGrammar, Registry, type IGrammar, type IRawGrammar, INITIAL } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";

const BAF_SYNTAX_PATH = path.resolve(__dirname, "../../../syntaxes/weidu-baf.tmLanguage.json");
const ONIG_WASM_PATH = path.resolve(__dirname, "../../../node_modules/vscode-oniguruma/release/onig.wasm");

let grammar: IGrammar;

export function getTokenScopes(text: string, lineNumber: number, target: string): readonly string[] {
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
            if (scopeName === "source.weidu-baf") {
                return parseRawGrammar(readFileSync(BAF_SYNTAX_PATH, "utf-8"), BAF_SYNTAX_PATH) as IRawGrammar;
            }
            return null;
        },
    });

    grammar = (await registry.loadGrammar("source.weidu-baf"))!;
});

describe("weidu-baf TextMate syntax - scope contract", () => {
    it("colors an ALL-CAPS IDS constant as a constant", () => {
        const scopes = getTokenScopes("IF General(Myself,NEUTRAL) THEN", 0, "NEUTRAL");
        expect(scopes).toContain("constant.other.weidu-baf");
    });

    it("colors a trigger name as a trigger, not a constant", () => {
        const scopes = getTokenScopes("IF General(Myself,NEUTRAL) THEN", 0, "General");
        expect(scopes).toContain("entity.name.function.trigger.weidu-baf");
        expect(scopes).not.toContain("constant.other.weidu-baf");
    });

    it("colors an ALL-CAPS SHORT-FORM trigger as a trigger, not a constant", () => {
        // HP/XP/G/LOS and 8 more are ALL-CAPS trigger names. A casing rule would claim them as constants
        // unless the trigger stanza is ordered first. This is the ordering regression guard.
        const scopes = getTokenScopes("IF HP(50) THEN", 0, "HP");
        expect(scopes).toContain("entity.name.function.trigger.weidu-baf");
        expect(scopes).not.toContain("constant.other.weidu-baf");
    });

    it("colors the ALL-CAPS SG action as an action, not a constant", () => {
        const scopes = getTokenScopes('IF True() THEN\nRESPONSE #100\nSG("x",1)\nEND', 2, "SG");
        expect(scopes).toContain("support.function.weidu-baf");
        expect(scopes).not.toContain("constant.other.weidu-baf");
    });

    it("colors CasterHold as a constant despite being CamelCase", () => {
        // CasterHold is genuine STATS.IDS entry 70 (verified in IESDP for bg1/bg2/iwd) while all 223 of its
        // siblings are ALL-CAPS. A casing rule cannot express it, so it stays enumerated.
        const scopes = getTokenScopes("IF CheckStat(Myself,1,CasterHold) THEN", 0, "CasterHold");
        expect(scopes).toContain("constant.other.weidu-baf");
    });

    it("colors a hyphenated IDS constant as ONE constant, not fragments", () => {
        // \b[A-Z][A-Z0-9_]*\b would match KUO and TOA separately. The hyphenated names stay enumerated
        // ahead of the casing rule.
        const scopes = getTokenScopes("IF Race(Myself,KUO-TOA) THEN", 0, "KUO-TOA");
        expect(scopes).toContain("constant.other.weidu-baf");
    });

    it("colors a CamelCase object-id as a constant", () => {
        // OBJECT.IDS entries are CamelCase and stay enumerated - casing cannot reach them.
        const scopes = getTokenScopes("IF True() THEN\nRESPONSE #100\nKill(NearestEnemyOf)\nEND", 2, "NearestEnemyOf");
        expect(scopes).toContain("constant.other.weidu-baf");
    });

    it("colors an ALL-CAPS constant containing digits", () => {
        // The casing rule that replaces the enumerated IDS vocabulary is \b[A-Z][A-Z0-9_]*\b. Dropping 0-9
        // from that character class would still colour NEUTRAL and every other letters-only constant, and
        // would silently stop colouring every digit-bearing one. This is the assertion that catches it.
        const scopes = getTokenScopes(
            "IF True() THEN\nRESPONSE #100\nApplySpell(Myself,ACID_DAMAGE_1)\nEND",
            2,
            "ACID_DAMAGE_1",
        );
        expect(scopes).toContain("constant.other.weidu-baf");
    });
});

describe("weidu-baf TextMate syntax - bracketed values", () => {
    const RESPONSE = "IF True() THEN\nRESPONSE #100\n";

    it("scopes an object specifier's components as constants and its brackets as punctuation", () => {
        // [EA.GENERAL] and friends: the component is the value, the brackets and dots are not. Both spellings
        // of a component scope as constant.* so a theme can paint them alike (bgforge-monokai does) or apart.
        const line = "IF See([NOTGOOD.HUMANOID]) THEN";
        expect(getTokenScopes(line, 0, "NOTGOOD")).toContain("constant.other.weidu-baf");
        expect(getTokenScopes(line, 0, "HUMANOID")).toContain("constant.other.weidu-baf");
        expect(getTokenScopes(line, 0, "[")).toContain("keyword.punctuation.bracket.weidu-baf");
        expect(getTokenScopes(line, 0, "]")).toContain("keyword.punctuation.bracket.weidu-baf");
    });

    it("scopes a numeric specifier component as a number, not a name", () => {
        // [ENEMY.0.0.MAGE]: a component may be an IDS name or its number. Both are constant.*; keeping the
        // numeric/other split is what lets a theme distinguish them if it wants to.
        const line = "IF See([0.0.0.MAGE_ALL]) THEN";
        expect(getTokenScopes(line, 0, "0")).toContain("constant.numeric.weidu-baf");
        expect(getTokenScopes(line, 0, "MAGE_ALL")).toContain("constant.other.weidu-baf");
    });

    it("scopes a single-component specifier", () => {
        const line = "IF See([PC]) THEN";
        expect(getTokenScopes(line, 0, "PC")).toContain("constant.other.weidu-baf");
        expect(getTokenScopes(line, 0, "[")).toContain("keyword.punctuation.bracket.weidu-baf");
    });

    it("scopes a point's coordinates as numbers", () => {
        // A point and a specifier are one rule here: [10.10] and [0.0] scope identically whichever the engine
        // reads them as, because a component scopes as what it is either way.
        const scopes = getTokenScopes(`${RESPONSE}MoveToPoint([10.10])\nEND`, 2, "10");
        expect(scopes).toContain("constant.numeric.weidu-baf");
        expect(scopes).not.toContain("constant.other.weidu-baf");
    });

    it("keeps a variable coordinate a variable, and scopes a negative one with its sign", () => {
        // A point's coordinate is whatever it is - a number or a %var% - never flattened to one scope.
        const varLine = `${RESPONSE}CreateCreature("x",[200.%py%],0)\nEND`;
        expect(getTokenScopes(varLine, 2, "%py%")).toContain("variable.parameter.weidu-baf");
        expect(getTokenScopes(varLine, 2, "200")).toContain("constant.numeric.weidu-baf");
        // The sign belongs to the number: [4.-4] is (4, -4), not 4 then a stray dash then 4.
        expect(getTokenScopes(`${RESPONSE}ScreenShake([4.-4],20)\nEND`, 2, "-4")).toContain(
            "constant.numeric.weidu-baf",
        );
    });

    it("leaves a call's own parentheses unscoped", () => {
        // Only the specifier and point forms carry punctuation scopes; BAF punctuation at large is not
        // coloured, so a call's parens stay plain.
        expect(getTokenScopes("IF See([PC]) THEN", 0, "(")).not.toContain("keyword.punctuation.bracket.weidu-baf");
    });
});
