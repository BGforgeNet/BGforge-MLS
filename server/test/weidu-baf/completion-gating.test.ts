/**
 * BAF completion is offered per position, not per file: the trigger/action vocabulary is suppressed inside
 * comments. Quoted strings deliberately keep it - see the provider's rationale.
 */
import { describe, expect, it, beforeAll, vi } from "vitest";
vi.mock("../../src/logger", () => ({
    conlog: vi.fn(),
}));

import { weiduBafProvider } from "../../src/weidu-baf/provider";
import { initParser } from "../../../shared/parsers/weidu-baf";
import { normalizeUri } from "../../src/core/normalized-uri";
import type { CompletionItem, Position } from "vscode-languageserver/node";

beforeAll(async () => {
    await initParser();
});

const URI = normalizeUri("file:///t.baf");
const lines = [
    "// wandering guard, do not attack the player",
    "/* an older revision lived here */",
    "IF",
    '  Global("myvar","GLOBAL",1)',
    "THEN",
    "  RESPONSE #100",
    "    Continue()",
    "END",
];
const text = lines.join("\n");
function at(line: number, token: string): Position {
    const source = lines[line];
    if (source === undefined) throw new Error(`no line ${line}`);
    const index = source.indexOf(token);
    if (index === -1) throw new Error(`no ${token} on line ${line}`);
    return { line, character: index + 1 };
}

const items: CompletionItem[] = [{ label: "SENTINEL_BAF_ITEM" }];
const filter = (position: Position): CompletionItem[] =>
    weiduBafProvider.filterCompletions!(items, text, position, URI);

describe("weiduBafProvider.filterCompletions", () => {
    it("suppresses the vocabulary inside a line comment", () => {
        expect(filter(at(0, "attack"))).toEqual([]);
    });

    it("suppresses the vocabulary inside a block comment", () => {
        expect(filter(at(1, "revision"))).toEqual([]);
    });

    it("offers the vocabulary at a code position", () => {
        expect(filter(at(6, "Continue"))).toBe(items);
    });

    // A quoted BAF argument is a value slot the vocabulary answers: "GLOBAL"/"LOCALS"/"MYAREA" are the scope
    // names Global() takes. Suppressing strings here would remove a real completion, unlike in D.
    it("offers the vocabulary inside a quoted argument", () => {
        expect(filter(at(3, "GLOBAL"))).toBe(items);
    });
});
