import { describe, expect, it, beforeAll, vi } from "vitest";
vi.mock("../../src/logger", () => ({
    conlog: vi.fn(),
}));

// See embedded-baf.test.ts: unit tests import source, so the real BAF completion JSON (in out/) is not on
// __dirname. Mock loadStaticSymbols with representative BAF symbols so the provider's embedded-BAF path is
// exercised deterministically; real data is covered by the code-server live drive.
vi.mock("../../src/core/static-loader", () => ({
    loadStaticSymbols: vi.fn(() => [
        {
            name: "Acquired",
            kind: "trigger",
            location: null,
            scope: { level: 0 },
            source: { type: 0, uri: null },
            completion: { label: "Acquired", kind: 6 },
            hover: { contents: { kind: "markdown", value: "Acquired(S:ResRef*) trigger" } },
        },
        {
            name: "ActionOverride",
            kind: "action",
            location: null,
            scope: { level: 0 },
            source: { type: 0, uri: null },
            completion: { label: "ActionOverride", kind: 3 },
            hover: { contents: { kind: "markdown", value: "ActionOverride(O:Actor,A:Action) action" } },
        },
    ]),
}));

import { weiduDProvider } from "../../src/weidu-d/provider";
import { initEmbeddedBaf } from "../../src/weidu-d/embedded-baf";
import { initParser } from "../../../shared/parsers/weidu-d";
import { normalizeUri } from "../../src/core/normalized-uri";
import type { Position } from "vscode-languageserver/node";

beforeAll(async () => {
    await initParser();
    initEmbeddedBaf();
});

const URI = normalizeUri("file:///t.d");
const lines = [
    "BEGIN ~DLG~",
    "/** Greeting state */",
    'IF ~Acquired("SW1H01","GLOBAL",1)~ THEN BEGIN greeting',
    "    SAY ~Hi~",
    "END",
];
const text = lines.join("\n");
function at(line: number, token: string): Position {
    const source = lines[line];
    if (source === undefined) throw new Error(`no line ${line}`);
    return { line, character: source.indexOf(token) + 1 };
}

describe("weiduDProvider.hover - embedded BAF", () => {
    it("resolves a BAF trigger hovered inside a trigger string", () => {
        const result = weiduDProvider.hover!(text, "Acquired", URI, at(2, "Acquired"));
        expect(result.handled).toBe(true);
        if (result.handled) expect(result.hover).not.toBeNull();
    });

    it("falls through (notHandled) for a non-BAF word inside a trigger string", () => {
        const result = weiduDProvider.hover!(text, "Nonexistent", URI, at(2, "Acquired"));
        expect(result.handled).toBe(false);
    });

    it("still hovers a D state label outside any embedded region", () => {
        const result = weiduDProvider.hover!(text, "greeting", URI, at(2, "greeting"));
        expect(result.handled).toBe(true);
        if (result.handled) expect(result.hover).not.toBeNull();
    });
});
