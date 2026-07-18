/**
 * TP2 call hierarchy - prepare / outgoing / incoming over the module's pure logic (cross-file
 * resolution and file reads injected). Covers the design-critical case: an incoming caller that is a
 * top-level component install body, not another function.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Location, Position } from "vscode-languageserver/node";

vi.mock("../../src/server", () => ({
    connection: { console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }, sendDiagnostics: vi.fn() },
}));

import {
    prepareCallHierarchy,
    outgoingCalls,
    incomingCalls,
    type DefLookup,
    type TextLookup,
} from "../../src/weidu-tp2/call-hierarchy";
import { initParser } from "../../../shared/parsers/weidu-tp2";

beforeAll(async () => {
    await initParser();
});

const URI = "file:///test.tp2";
const TEXT = `DEFINE_ACTION_FUNCTION helper
BEGIN
  PRINT ~hi~
END

DEFINE_ACTION_FUNCTION caller
BEGIN
  LAF helper END
END

BEGIN ~My Component~
  LAF helper END
`;
const getText: TextLookup = (uri) => (uri === URI ? TEXT : null);
const noCrossFile: DefLookup = () => null;

/** Position just inside the Nth occurrence of `needle`. */
function posOf(needle: string, occurrence = 1): Position {
    const lines = TEXT.split("\n");
    let count = 0;
    for (let line = 0; line < lines.length; line++) {
        const idx = lines[line]!.indexOf(needle);
        if (idx !== -1 && ++count === occurrence) return { line, character: idx + 1 };
    }
    throw new Error(`occurrence ${occurrence} of "${needle}" not found`);
}

/** Every occurrence of `name` as a Location - mimics what refs.lookup returns (defs AND calls). */
function allRefs(name: string): Location[] {
    const locs: Location[] = [];
    TEXT.split("\n").forEach((lineText, line) => {
        let idx = lineText.indexOf(name);
        while (idx !== -1) {
            locs.push({
                uri: URI,
                range: { start: { line, character: idx }, end: { line, character: idx + name.length } },
            });
            idx = lineText.indexOf(name, idx + 1);
        }
    });
    return locs;
}

describe("TP2 call hierarchy", () => {
    it("prepare on a definition name yields the function item at its definition", () => {
        const items = prepareCallHierarchy(TEXT, posOf("helper", 1), URI, noCrossFile);
        expect(items).not.toBeNull();
        expect(items![0]!.name).toBe("helper");
        expect(items![0]!.selectionRange.start.line).toBe(0);
    });

    it("prepare on a LAF launch resolves to the definition", () => {
        const items = prepareCallHierarchy(TEXT, posOf("helper", 2), URI, noCrossFile);
        expect(items).not.toBeNull();
        expect(items![0]!.name).toBe("helper");
        expect(items![0]!.selectionRange.start.line).toBe(0);
    });

    it("prepare off any callable returns null", () => {
        expect(prepareCallHierarchy(TEXT, posOf("PRINT", 1), URI, noCrossFile)).toBeNull();
    });

    it("outgoing lists the launches inside a function body", () => {
        const caller = prepareCallHierarchy(TEXT, posOf("caller", 1), URI, noCrossFile)![0]!;
        const out = outgoingCalls(caller, getText, noCrossFile);
        expect(out.map((o) => o.to.name)).toEqual(["helper"]);
    });

    it("incoming groups callers: a function AND a top-level component", () => {
        const helper = prepareCallHierarchy(TEXT, posOf("helper", 1), URI, noCrossFile)![0]!;
        const callers = incomingCalls(helper, allRefs("helper"), getText)
            .map((c) => c.from.name)
            .sort();
        expect(callers).toEqual(["My Component", "caller"]);
    });
});
