/**
 * TextMate scopes of the MSG and TRA grammars against actual tokenization. The scopes follow the readers the
 * rest of the project uses: a `.msg` brace group is an entry wherever it sits and only the text outside the
 * groups is skipped (comment-coloured); a `.tra` file has nested block comments, `^` joins, bare-word strings
 * and `#N` / `@N` values.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseRawGrammar, Registry, type IGrammar, INITIAL } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";

const SYNTAXES = path.resolve(__dirname, "../../../syntaxes");
const ONIG_WASM_PATH = createRequire(__filename).resolve("vscode-oniguruma/release/onig.wasm");

const FILES: Record<string, string> = {
    "source.fallout-msg": "fallout-msg.tmLanguage.json",
    "source.weidu-tra": "weidu-tra.tmLanguage.json",
    "source.weidu-tp2": "weidu-tp2.tmLanguage.json",
};

let msg: IGrammar;
let tra: IGrammar;

/** The scopes of the `occurrence`-th appearance of `target` in `text`, tokenizing every line in order. */
function scopesOf(grammar: IGrammar, text: string, target: string, occurrence = 1): readonly string[] {
    let offset = -1;
    for (let found = 0; found < occurrence; found++) offset = text.indexOf(target, offset + 1);
    expect(offset, `"${target}" not found`).toBeGreaterThanOrEqual(0);
    let ruleStack = INITIAL;
    let lineStart = 0;
    let scopes: readonly string[] | undefined;
    for (const line of text.split("\n")) {
        const tokenized = grammar.tokenizeLine(line, ruleStack);
        ruleStack = tokenized.ruleStack;
        const column = offset - lineStart;
        if (scopes === undefined && column >= 0 && column <= line.length) {
            scopes = tokenized.tokens.find((t) => t.startIndex <= column && t.endIndex > column)?.scopes;
        }
        lineStart += line.length + 1;
    }
    expect(scopes, `no token at "${target}"`).toBeDefined();
    return scopes!;
}

beforeAll(async () => {
    await loadWASM(readFileSync(ONIG_WASM_PATH).buffer);
    const registry = new Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
            createOnigString: (text: string) => new OnigString(text),
        }),
        loadGrammar: async (scopeName) => {
            const file = FILES[scopeName];
            if (file === undefined) return null;
            const filePath = path.join(SYNTAXES, file);
            return parseRawGrammar(readFileSync(filePath, "utf-8"), filePath);
        },
    });
    msg = (await registry.loadGrammar("source.fallout-msg"))!;
    tra = (await registry.loadGrammar("source.weidu-tra"))!;
});

describe("fallout-msg TextMate syntax", () => {
    it("scopes the fields of an entry", () => {
        const text = "{100}{snd file}{Hello there}";
        expect(scopesOf(msg, text, "100")).toContain("constant.other.linenum.fallout-msg");
        expect(scopesOf(msg, text, "snd file")).toContain("entity.name.function.sound.fallout-msg");
        expect(scopesOf(msg, text, "Hello there")).toContain("string.quoted.fallout-msg");
    });

    it("scopes a signed number as the entry number", () => {
        expect(scopesOf(msg, "{-5}{}{minus}", "-5")).toContain("constant.other.linenum.fallout-msg");
    });

    it("scopes an entry on a # line as an entry, not a comment", () => {
        const text = "# {200}{}{live}";
        expect(scopesOf(msg, text, "200")).toContain("constant.other.linenum.fallout-msg");
        expect(scopesOf(msg, text, "live")).toContain("string.quoted.fallout-msg");
        expect(scopesOf(msg, text, "live")).not.toContain("comment.line.fallout-msg");
        expect(scopesOf(msg, text, "# ")).toContain("comment.line.fallout-msg");
    });

    it("scopes an entry on a // line and inside /* */ as an entry", () => {
        expect(scopesOf(msg, "// {200}{}{live}", "200")).toContain("constant.other.linenum.fallout-msg");
        const block = "/* {201}{}{live} */";
        expect(scopesOf(msg, block, "201")).toContain("constant.other.linenum.fallout-msg");
        expect(scopesOf(msg, block, "/*")).toContain("comment.line.fallout-msg");
        expect(scopesOf(msg, block, "*/")).toContain("comment.line.fallout-msg");
    });

    it("scopes free text outside the groups as skipped text, with or without a marker", () => {
        expect(scopesOf(msg, "free words\n{1}{}{x}", "free words")).toContain("comment.line.fallout-msg");
        expect(scopesOf(msg, "{1}{}{x} # note", "# note")).toContain("comment.line.fallout-msg");
    });

    it("keeps multi-line text one string", () => {
        const text = "{1}{}{line one\nline two}\n{2}{}{x}";
        expect(scopesOf(msg, text, "line two")).toContain("string.quoted.fallout-msg");
        expect(scopesOf(msg, text, "2")).toContain("constant.other.linenum.fallout-msg");
    });

    it("flags a closing brace outside an entry, which the game refuses to load", () => {
        expect(scopesOf(msg, "# stray } here\n{1}{}{x}", "}")).toContain("invalid.illegal.fallout-msg");
    });
});

describe("weidu-tra TextMate syntax", () => {
    it("scopes an entry number and the three string forms", () => {
        const text = '@1 = ~tilde~\n@2 = "double"\n@3 = %percent%';
        expect(scopesOf(tra, text, "1")).toContain("constant.language.weidu-tra");
        expect(scopesOf(tra, text, "tilde")).toContain("string.quoted.weidu-tra");
        expect(scopesOf(tra, text, "double")).toContain("string.quoted.weidu-tra");
        expect(scopesOf(tra, text, "percent")).toContain("string.quoted.weidu-tra");
    });

    it("keeps a five-tilde string, tildes inside it included, one string", () => {
        const text = "@1 = ~~~~~a ~ b~~~~~\n@2 = ~x~";
        expect(scopesOf(tra, text, "b")).toContain("string.quoted.weidu-tra");
        expect(scopesOf(tra, text, "2")).toContain("constant.language.weidu-tra");
    });

    it("keeps a nested block comment one comment", () => {
        const text = "/* a /* b */ still comment */\n@1 = ~x~";
        expect(scopesOf(tra, text, "still comment")).toContain("comment.block.weidu-tra");
        expect(scopesOf(tra, text, "1")).toContain("constant.language.weidu-tra");
    });

    it("scopes ^ as an operator", () => {
        expect(scopesOf(tra, "@1 = ~a~ ^ ~b~", "^")).toContain("keyword.operator.concatenation.weidu-tra");
    });

    it("scopes a bare word value as a string", () => {
        expect(scopesOf(tra, "@1 = bareword", "bareword")).toContain("string.quoted.weidu-tra");
        expect(scopesOf(tra, "@1 = ~a~ [SND]ND", "ND", 2)).toContain("string.quoted.weidu-tra");
    });

    it("scopes #N and an @N value as references", () => {
        expect(scopesOf(tra, "@1 = #5", "#5")).toContain("constant.language.weidu-tra");
        expect(scopesOf(tra, "@1 = ~one~\n@2 = @1", "@1", 2)).toContain("constant.language.weidu-tra");
    });

    it("scopes a sound holding a space, a hash or a variable", () => {
        expect(scopesOf(tra, "@1 = ~a~ [XAN 23]", "XAN 23")).toContain("entity.name.function.sound.weidu-tra");
        expect(scopesOf(tra, "@1 = ~a~ [X#BLANK]", "X#BLANK")).toContain("entity.name.function.sound.weidu-tra");
    });

    it("keeps comment markers inside a string as text", () => {
        expect(scopesOf(tra, "@1 = ~a // b~", "// b")).toContain("string.quoted.weidu-tra");
        expect(scopesOf(tra, "@1 = ~a~ // 100% done", "100%")).toContain("comment.line.weidu-tra");
    });
});
