/**
 * The MSG grammar's parse errors against the game's own loader: a file the game loads must parse clean, and a
 * file it refuses must carry a syntax error. The loader is `msg-engine-loader.ts`; the corpus half of this
 * check, over every real `.msg` file, is `integration/fallout-msg-engine-differential.test.ts`.
 */

import { beforeAll, describe, expect, it } from "vitest";
import * as msg from "@bgforge/shared/parsers/fallout-msg";
import { collectParseDiagnostics } from "../../src/shared/tree-sitter-diagnostics";
import { loadMsgLikeEngine } from "./msg-engine-loader";

beforeAll(async () => {
    await msg.initParser();
});

function grammarAccepts(text: string): boolean {
    const tree = msg.parseWithCache(text)!;
    return collectParseDiagnostics(tree.rootNode).length === 0;
}

const longField = (length: number): string => "x".repeat(length);

const LOADS: ReadonlyArray<readonly [string, string]> = [
    ["plain entry", "{100}{}{hello}\n"],
    ["audio field with a space", "{800}{Weapon Damage}{Light}\n"],
    ["audio field with padding spaces", "{100}{ a b }{hello}\n"],
    ["negative number", "{-5}{}{hello}\n"],
    ["positive-signed number", "{+5}{}{hello}\n"],
    ["a lone sign", "{+}{}{hello}\n"],
    ["newline inside the number", "{10\n0}{}{hello}\n"],
    ["a hash line is no comment", "# {200}{}{live}\n{100}{}{hello}\n"],
    ["a slash line is no comment", "// {200}{}{live}\n{100}{}{hello}\n"],
    ["a block opener is no comment", "/* {200}{}{live} */\n{100}{}{hello}\n"],
    ["a block opener never closed", "/* open\n{100}{}{hello}\n"],
    ["free text between entries", "some words\n{100}{}{hello}\nmore words\n"],
    ["junk between the fields of an entry", "{100} one {} two {hello}\n"],
    ["open brace inside text", "{100}{}{a { b}\n"],
    ["multi-line text", "{100}{}{line one\nline two}\n"],
    ["empty fields", "{100}{}{}\n"],
    ["repeated number", "{100}{}{a}\n{100}{}{b}\n"],
    ["text of 1023 characters", `{100}{}{${longField(1023)}}\n`],
    ["newlines do not count toward the limit", `{100}{}{${longField(600)}\n\n${longField(423)}\n}\n`],
    ["audio of 1023 characters", `{100}{${longField(1023)}}{hello}\n`],
    ["no entry at all", "just a note\n"],
    ["empty file", ""],
];

const FAILS: ReadonlyArray<readonly [string, string]> = [
    ["padded number", "{ 100 }{}{hello}\n"],
    ["empty number", "{}{}{hello}\n"],
    ["non-numeric number", "{abc}{}{hello}\n"],
    ["a closing brace in a note", "# stray } here\n{100}{}{hello}\n"],
    ["a closing brace in free text", "words } more\n{100}{}{hello}\n"],
    ["unterminated text", "{100}{}{hello\n"],
    ["two fields only", "{100}{}\n{101}{}{x}\n"],
    ["audio field left out", "{100}{hello}\n"],
    ["text of 1024 characters", `{100}{}{${longField(1024)}}\n`],
    ["audio of 1024 characters", `{100}{${longField(1024)}}{hello}\n`],
    ["number of 1024 characters", `{${"1".repeat(1024)}}{}{hello}\n`],
    ["a failing entry after good ones", "{100}{}{ok}\n{101}{}{ok}\n{ 102 }{}{bad}\n"],
];

describe("fallout-msg: the grammar and the game's loader agree", () => {
    it.each(LOADS)("loads and parses clean: %s", (_name, text) => {
        expect(loadMsgLikeEngine(text).ok).toBe(true);
        expect(grammarAccepts(text)).toBe(true);
    });

    it.each(FAILS)("fails to load and carries a syntax error: %s", (_name, text) => {
        expect(loadMsgLikeEngine(text).ok).toBe(false);
        expect(grammarAccepts(text)).toBe(false);
    });

    it("keeps the spaces at the edges of a field in the tree, as the game keeps them", () => {
        const text = "{100}{ a b }{ text }\n";
        const entry = msg.parseWithCache(text)!.rootNode.namedChildren[0]!;
        expect(entry.childForFieldName("audio")!.text).toBe(" a b ");
        expect(entry.childForFieldName("text")!.text).toBe(" text ");
        expect(loadMsgLikeEngine(text)).toEqual({
            ok: true,
            entries: new Map([[100, { number: 100, audio: " a b ", text: " text " }]]),
        });
    });
});
