/**
 * SSL completion is offered per position: suppressed inside a string literal, where no SSL name is valid.
 * The comment and JSDoc branches of the same gate are covered by `jsdoc-completion.test.ts`.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import type { CompletionItem, Position } from "vscode-languageserver/node";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
}));

vi.mock("../../src/logger", () => ({
    conlog: vi.fn(),
}));

import { falloutSslProvider } from "../../src/fallout-ssl/provider";
import { initParser } from "../../../shared/parsers/fallout-ssl";
import { normalizeUri } from "../../src/core/normalized-uri";

beforeAll(async () => {
    await initParser();
});

const URI = normalizeUri("file:///t.ssl");
const ITEMS: CompletionItem[] = [{ label: "SENTINEL_SSL_ITEM" }];

const lines = [
    '#include "define.h"',
    "",
    "procedure talk_p_proc begin",
    '   display_msg("you look tired, traveller");',
    "end",
];
const text = lines.join("\n");
function at(line: number, token: string): Position {
    const source = lines[line];
    if (source === undefined) throw new Error(`no line ${line}`);
    const index = source.indexOf(token);
    if (index === -1) throw new Error(`no ${token} on line ${line}`);
    return { line, character: index + 1 };
}
const labelsAt = (position: Position): unknown[] =>
    (falloutSslProvider.filterCompletions?.(ITEMS, text, position, URI) ?? []).map((item) => item.label);

describe("fallout-ssl completion inside a string", () => {
    it("suppresses completion inside a message string", () => {
        expect(labelsAt(at(3, "you look"))).toEqual([]);
    });

    // The one string SSL does resolve - but as a path, and no completion offers filenames, so the whole
    // vocabulary here is noise that also shadows what the user is typing.
    it("suppresses completion inside an include path", () => {
        expect(labelsAt(at(0, "define.h"))).toEqual([]);
    });

    it("still offers completion at a code position", () => {
        expect(labelsAt(at(3, "display_msg"))).toContain("SENTINEL_SSL_ITEM");
    });
});
