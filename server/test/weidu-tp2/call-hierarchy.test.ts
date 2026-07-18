/**
 * TP2 call hierarchy - prepare / outgoing / incoming over the module's pure logic (cross-file
 * resolution and file reads injected). Covers the design-critical case: an incoming caller that is a
 * top-level component install body, not another function.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { SymbolKind, type Location, type Position } from "vscode-languageserver/node";

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

const MACRO_URI = "file:///macro.tp2";
const MACRO_TEXT = `DEFINE_ACTION_MACRO my_macro
BEGIN
  PRINT ~hi~
END

DEFINE_ACTION_FUNCTION uses_macro
BEGIN
  LAM my_macro
END
`;
const macroGetText: TextLookup = (uri) => (uri === MACRO_URI ? MACRO_TEXT : null);

function macroPos(needle: string, occurrence = 1): Position {
    const lines = MACRO_TEXT.split("\n");
    let count = 0;
    for (let line = 0; line < lines.length; line++) {
        const idx = lines[line]!.indexOf(needle);
        if (idx !== -1 && ++count === occurrence) return { line, character: idx + 1 };
    }
    throw new Error(`occurrence ${occurrence} of "${needle}" not found`);
}

function macroRefs(name: string): Location[] {
    const locs: Location[] = [];
    MACRO_TEXT.split("\n").forEach((lineText, line) => {
        let idx = lineText.indexOf(name);
        while (idx !== -1) {
            locs.push({
                uri: MACRO_URI,
                range: { start: { line, character: idx }, end: { line, character: idx + name.length } },
            });
            idx = lineText.indexOf(name, idx + 1);
        }
    });
    return locs;
}

describe("TP2 call hierarchy - macros (DEFINE_*_MACRO / LAM / LPM)", () => {
    it("prepare on a LAM launch resolves to the macro definition", () => {
        const items = prepareCallHierarchy(MACRO_TEXT, macroPos("my_macro", 2), MACRO_URI, noCrossFile);
        expect(items).not.toBeNull();
        expect(items![0]!.name).toBe("my_macro");
        expect(items![0]!.selectionRange.start.line).toBe(0);
    });

    it("outgoing lists a LAM launch inside a function body", () => {
        const fn = prepareCallHierarchy(MACRO_TEXT, macroPos("uses_macro", 1), MACRO_URI, noCrossFile)![0]!;
        const out = outgoingCalls(fn, macroGetText, noCrossFile);
        expect(out.map((o) => o.to.name)).toEqual(["my_macro"]);
    });

    it("incoming groups a macro's launchers", () => {
        const macro = prepareCallHierarchy(MACRO_TEXT, macroPos("my_macro", 1), MACRO_URI, noCrossFile)![0]!;
        const callers = incomingCalls(macro, macroRefs("my_macro"), macroGetText).map((c) => c.from.name);
        expect(callers).toEqual(["uses_macro"]);
    });
});

/** Every occurrence of `name` in arbitrary `text` as a Location. */
function locsOf(text: string, uri: string, name: string): Location[] {
    const locs: Location[] = [];
    text.split("\n").forEach((line, lineNo) => {
        let idx = line.indexOf(name);
        while (idx !== -1) {
            locs.push({
                uri,
                range: { start: { line: lineNo, character: idx }, end: { line: lineNo, character: idx + name.length } },
            });
            idx = line.indexOf(name, idx + 1);
        }
    });
    return locs;
}

describe("TP2 call hierarchy - cross-file and top-level", () => {
    const XF_URI = "file:///xf.tp2";

    it("outgoing resolves a launch of a function defined in another file", () => {
        const OTHER = "file:///lib.tph";
        const cross: DefLookup = (name) =>
            name === "lib_fn"
                ? { uri: OTHER, range: { start: { line: 5, character: 23 }, end: { line: 5, character: 29 } } }
                : null;
        const text = `DEFINE_ACTION_FUNCTION caller\nBEGIN\n  LAF lib_fn END\nEND\n`;
        const item = prepareCallHierarchy(text, { line: 0, character: 24 }, XF_URI, cross)![0]!;
        const out = outgoingCalls(item, (u) => (u === XF_URI ? text : null), cross);
        expect(out).toHaveLength(1);
        expect(out[0]!.to.name).toBe("lib_fn");
        expect(out[0]!.to.uri).toBe(OTHER);
    });

    it("incoming attributes a top-level launch (outside any function or component) to the file", () => {
        const text = `DEFINE_ACTION_FUNCTION helper\nBEGIN\n  PRINT ~hi~\nEND\n\nLAF helper END\n`;
        const helper = prepareCallHierarchy(text, { line: 0, character: 24 }, XF_URI, noCrossFile)![0]!;
        const calls = incomingCalls(helper, locsOf(text, XF_URI, "helper"), (u) => (u === XF_URI ? text : null));
        expect(calls.map((c) => c.from.name)).toEqual(["xf.tp2"]);
        expect(calls[0]!.from.kind).toBe(SymbolKind.File);
    });
});
