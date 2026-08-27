/**
 * Validates WeiDU D TextMate scopes against actual tokenization, focused on embedded-BAF delegation.
 * The D grammar delegates trigger/action string bodies to source.weidu-baf, so the registry resolves
 * both grammars.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseRawGrammar, Registry, type IGrammar, INITIAL } from "vscode-textmate";
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

/**
 * The patch commands take their trigger/action as a bare tilde-string with no IF/DO to key on, so each rule
 * has to count the arguments the command's own syntax puts before it (README-WeiDU, "d Action" commands).
 * Getting that wrong is silent: the body still renders as a plain string, which is what it did before.
 */
describe("weidu-d TextMate syntax - patch commands", () => {
    it("colors an ADD_STATE_TRIGGER body as an embedded condition", () => {
        const scopes = getTokenScopes('ADD_STATE_TRIGGER bsarev25 105 ~Dead("gromnir")~', 0, "Dead");
        expect(scopes).toContain("meta.weidu-d.condition");
    });

    it("keeps the command keyword's own scope", () => {
        const scopes = getTokenScopes('ADD_STATE_TRIGGER bsarev25 105 ~Dead("gromnir")~', 0, "ADD_STATE_TRIGGER");
        expect(scopes).toContain("support.function.weidu-baf.action");
    });

    // The filename argument may ITSELF be a tilde-string, so "the first ~ after the keyword" would colour the
    // file as a trigger. The rule counts arguments instead; this is the case that catches it not doing so.
    //
    // Asserted on the BAF scopes rather than the statement's own `meta.*`, which spans the whole command
    // (keyword and arguments included) exactly as the plain `IF ~...~` rule's does. Delegation is the property
    // in question: the body resolves to a BAF trigger, the filename stays an ordinary D string.
    it("does not treat a tilde-quoted filename as the trigger", () => {
        const line = 'ADD_STATE_TRIGGER ~imoen2p~ 8 ~Global("ENDOFBG1","GLOBAL",2)~ 11';
        expect(getTokenScopes(line, 0, "imoen2p")).toContain("string.quoted.tilde.weidu-d");
        expect(getTokenScopes(line, 0, "imoen2p").some((s) => s.endsWith(".weidu-baf"))).toBe(false);
        expect(getTokenScopes(line, 0, "Global")).toContain("entity.name.function.trigger.weidu-baf");
    });

    // The trigger is not the last argument, so the rule must release the line at the closing tilde: the
    // trailing state numbers belong to the command, not to the embedded trigger.
    it("releases the line after the trigger string", () => {
        const line = 'ADD_STATE_TRIGGER ~imoen2p~ 8 ~Global("ENDOFBG1","GLOBAL",2)~ 11';
        expect(getTokenScopes(line, 0, "11")).not.toContain("meta.weidu-d.condition");
    });

    it("handles a %variable% filename and state", () => {
        const line = 'ADD_STATE_TRIGGER %XAN_POST% %xanpstate3% ~!Global("X#XA","GLOBAL",2)~';
        expect(getTokenScopes(line, 0, "Global")).toContain("meta.weidu-d.condition");
    });

    it("colors REPLACE_STATE_TRIGGER and ADD_TRANS_TRIGGER bodies as conditions", () => {
        expect(getTokenScopes("REPLACE_STATE_TRIGGER finmel01 9 ~False()~", 0, "False")).toContain(
            "meta.weidu-d.condition",
        );
        expect(
            getTokenScopes('ADD_TRANS_TRIGGER finmel01 1 ~Global("BalthazarFights","GLOBAL",0)~ DO 1', 0, "Global"),
        ).toContain("meta.weidu-d.condition");
    });

    // The trigger string is not the last argument: state numbers and a DO clause can follow it, and they keep
    // their own colouring only if the rule ends at the closing tilde rather than running to end of line.
    it("releases the line after the trigger so a trailing DO clause still colors", () => {
        const line = 'ADD_TRANS_TRIGGER finmel01 1 ~Global("BalthazarFights","GLOBAL",0)~ DO 1';
        expect(getTokenScopes(line, 0, "DO")).toContain("keyword.other.weidu-d");
    });

    // The BEGIN..END argument blocks sit between the filename and the string, so these need their own rule.
    it("colors an ADD_TRANS_ACTION body as an embedded action, past both BEGIN..END blocks", () => {
        const line = 'ADD_TRANS_ACTION ~emers2~ BEGIN 0 END BEGIN END ~SetGlobal("A6Goodbye","GLOBAL",1)~';
        expect(getTokenScopes(line, 0, "SetGlobal")).toContain("meta.weidu-d.action");
        expect(getTokenScopes(line, 0, "SetGlobal").some((s) => s.endsWith(".weidu-baf"))).toBe(true);
        expect(getTokenScopes(line, 0, "emers2").some((s) => s.endsWith(".weidu-baf"))).toBe(false);
    });

    // REPLACE_* takes oldText AND newText, so both strings are bodies of the same kind.
    it("colors both strings of a REPLACE_TRANS_ACTION as actions", () => {
        const line = "REPLACE_TRANS_ACTION ~gerde~ BEGIN 1 END BEGIN END ~EscapeAreaDestroy(90)~ ~Kill(Myself)~";
        expect(getTokenScopes(line, 0, "EscapeAreaDestroy")).toContain("meta.weidu-d.action");
        expect(getTokenScopes(line, 0, "Kill")).toContain("meta.weidu-d.action");
    });

    // Same argument shape as REPLACE_TRANS_ACTION but the strings are TRIGGERS - the one place the two
    // families differ, and the reason they are separate rules rather than one keyword alternation.
    it("colors both strings of a REPLACE_TRANS_TRIGGER as conditions", () => {
        const line = "REPLACE_TRANS_TRIGGER wsmith01 BEGIN g_2things END BEGIN END ~PartyGoldGT(7499)~ ~Dead(Myself)~";
        expect(getTokenScopes(line, 0, "PartyGoldGT")).toContain("meta.weidu-d.condition");
        expect(getTokenScopes(line, 0, "Dead")).toContain("meta.weidu-d.condition");
    });

    // ADD_TRANS_ACTION's string is optional; with it omitted the rule must not swallow a trailing clause.
    it("leaves a trailing UNLESS clause colorable when the action string is omitted", () => {
        const line = "ADD_TRANS_ACTION %tutu_var%SAREVO BEGIN 15 16 END BEGIN END UNLESS ~foo~";
        expect(getTokenScopes(line, 0, "UNLESS")).toContain("keyword.other.weidu-d");
    });
});
