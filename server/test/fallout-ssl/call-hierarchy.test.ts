/**
 * Fallout SSL call hierarchy - prepare / outgoing / incoming over the module's pure logic (cross-file
 * resolution and file reads injected). SSL's callable unit is the `procedure`, referenced three ways:
 * a `call` statement, an expression-form call, and a `@proc` reference - all count as edges.
 */

import { describe, it, expect, beforeAll } from "vitest";
import type { Location, Position } from "vscode-languageserver/node";

import {
    prepareCallHierarchy,
    outgoingCalls,
    incomingCalls,
    type DefLookup,
    type TextLookup,
} from "../../src/fallout-ssl/call-hierarchy";
import { initParser } from "../../../shared/parsers/fallout-ssl";

beforeAll(async () => {
    await initParser();
});

const URI = "file:///test.ssl";
const TEXT = `procedure helper begin
    display_msg("hi");
end

procedure caller begin
    call helper;
    helper();
    x = @helper;
end

procedure other begin
    call caller;
end

procedure router begin
    NOption(100, helper, 4);
end
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

/** Every occurrence of `name` as a Location - mimics what refs.lookup returns (def AND references). */
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

describe("Fallout SSL call hierarchy", () => {
    it("prepare on a procedure definition name yields the procedure item at its definition", () => {
        const items = prepareCallHierarchy(TEXT, posOf("helper", 1), URI, noCrossFile);
        expect(items).not.toBeNull();
        expect(items![0]!.name).toBe("helper");
        expect(items![0]!.selectionRange.start.line).toBe(0);
    });

    it("prepare on a call site resolves to the definition", () => {
        // "helper" occurrence 2 is `call helper;` inside `caller`.
        const items = prepareCallHierarchy(TEXT, posOf("helper", 2), URI, noCrossFile);
        expect(items).not.toBeNull();
        expect(items![0]!.name).toBe("helper");
        expect(items![0]!.selectionRange.start.line).toBe(0);
    });

    it("prepare off any procedure (a builtin call) returns null", () => {
        expect(prepareCallHierarchy(TEXT, posOf("display_msg", 1), URI, noCrossFile)).toBeNull();
    });

    it("outgoing groups all three reference forms to one callee, excluding builtins", () => {
        const caller = prepareCallHierarchy(TEXT, posOf("caller", 1), URI, noCrossFile)![0]!;
        const out = outgoingCalls(caller, getText, noCrossFile);
        expect(out.map((o) => o.to.name)).toEqual(["helper"]);
        // call helper; + helper(); + @helper -> three launch-name ranges to the one callee.
        expect(out[0]!.fromRanges).toHaveLength(3);
    });

    it("outgoing on a procedure that only calls builtins is empty", () => {
        const helper = prepareCallHierarchy(TEXT, posOf("helper", 1), URI, noCrossFile)![0]!;
        expect(outgoingCalls(helper, getText, noCrossFile)).toEqual([]);
    });

    it("incoming groups every reference of a procedure by its enclosing caller", () => {
        const helper = prepareCallHierarchy(TEXT, posOf("helper", 1), URI, noCrossFile)![0]!;
        const callers = incomingCalls(helper, allRefs("helper"), getText)
            .map((c) => c.from.name)
            .sort();
        // caller (call + expr + @) and router (bare NOption arg) both reach helper.
        expect(callers).toEqual(["caller", "router"]);
    });

    it("incoming attributes a call to its own enclosing procedure", () => {
        const caller = prepareCallHierarchy(TEXT, posOf("caller", 1), URI, noCrossFile)![0]!;
        const calls = incomingCalls(caller, allRefs("caller"), getText);
        expect(calls.map((c) => c.from.name)).toEqual(["other"]);
    });

    it("counts a procedure passed as a bare macro argument (dialog-option target)", () => {
        // `NOption(100, helper, 4)` - helper is a bare identifier arg, not a call/@ - but names a procedure.
        const router = prepareCallHierarchy(TEXT, posOf("router", 1), URI, noCrossFile)![0]!;
        const out = outgoingCalls(router, getText, noCrossFile);
        expect(out.map((o) => o.to.name)).toEqual(["helper"]);
        // NOption itself is a macro, not a procedure - it is not an edge.
    });

    it("prepare on a bare macro-argument procedure name resolves to the definition", () => {
        // "helper" occurrence 5 is the bare arg inside `NOption(100, helper, 4)` (after def, call, expr, @).
        const items = prepareCallHierarchy(TEXT, posOf("helper", 5), URI, noCrossFile);
        expect(items).not.toBeNull();
        expect(items![0]!.name).toBe("helper");
        expect(items![0]!.selectionRange.start.line).toBe(0);
    });

    it("outgoing resolves a callee defined in another file via the cross-file lookup", () => {
        const OTHER = "file:///other.ssl";
        const crossFile: DefLookup = (name) =>
            name === "shared_proc"
                ? { uri: OTHER, range: { start: { line: 3, character: 10 }, end: { line: 3, character: 21 } } }
                : null;
        const text = `procedure local_caller begin\n    call shared_proc;\nend\n`;
        const item = prepareCallHierarchy(text, { line: 0, character: 12 }, URI, crossFile)![0]!;
        const out = outgoingCalls(item, (uri) => (uri === URI ? text : null), crossFile);
        expect(out).toHaveLength(1);
        expect(out[0]!.to.name).toBe("shared_proc");
        expect(out[0]!.to.uri).toBe(OTHER);
    });
});

const MAC_URI = "file:///macros.ssl";
// A parameterized macro, a NO-PARAM macro that invokes a procedure (still callable), and a plain
// constant (not callable). worker invokes both macros and reads the constant.
const MAC_TEXT = `#define LOG_IT(m) display_msg(m)
#define RUN target()
#define MAX_HP 100

procedure worker begin
    LOG_IT("hi");
    RUN;
    variable hp := MAX_HP;
end

procedure target begin
    display_msg("t");
end
`;
const macGetText: TextLookup = (uri) => (uri === MAC_URI ? MAC_TEXT : null);

function macPos(needle: string, occurrence = 1): Position {
    const lines = MAC_TEXT.split("\n");
    let count = 0;
    for (let line = 0; line < lines.length; line++) {
        const idx = lines[line]!.indexOf(needle);
        if (idx !== -1 && ++count === occurrence) return { line, character: idx + 1 };
    }
    throw new Error(`occurrence ${occurrence} of "${needle}" not found`);
}

function macRefs(name: string): Location[] {
    const locs: Location[] = [];
    MAC_TEXT.split("\n").forEach((lineText, line) => {
        let idx = lineText.indexOf(name);
        while (idx !== -1) {
            locs.push({
                uri: MAC_URI,
                range: { start: { line, character: idx }, end: { line, character: idx + name.length } },
            });
            idx = lineText.indexOf(name, idx + 1);
        }
    });
    return locs;
}

describe("Fallout SSL call hierarchy - macros", () => {
    it("prepare on a parameterized macro definition yields its item", () => {
        const items = prepareCallHierarchy(MAC_TEXT, macPos("LOG_IT", 1), MAC_URI, noCrossFile);
        expect(items).not.toBeNull();
        expect(items![0]!.name).toBe("LOG_IT");
    });

    it("prepare on a no-param macro that invokes a procedure yields its item", () => {
        const items = prepareCallHierarchy(MAC_TEXT, macPos("RUN", 1), MAC_URI, noCrossFile);
        expect(items).not.toBeNull();
        expect(items![0]!.name).toBe("RUN");
    });

    it("prepare on a plain constant define returns null (not callable)", () => {
        expect(prepareCallHierarchy(MAC_TEXT, macPos("MAX_HP", 1), MAC_URI, noCrossFile)).toBeNull();
    });

    it("outgoing from a procedure lists invoked macros, excluding the constant and builtins", () => {
        const worker = prepareCallHierarchy(MAC_TEXT, macPos("worker", 1), MAC_URI, noCrossFile)![0]!;
        const out = outgoingCalls(worker, macGetText, noCrossFile)
            .map((o) => o.to.name)
            .sort();
        expect(out).toEqual(["LOG_IT", "RUN"]);
    });

    it("outgoing from a macro lists the procedures its body invokes", () => {
        const run = prepareCallHierarchy(MAC_TEXT, macPos("RUN", 1), MAC_URI, noCrossFile)![0]!;
        const out = outgoingCalls(run, macGetText, noCrossFile);
        expect(out.map((o) => o.to.name)).toEqual(["target"]);
    });

    it("incoming attributes a call inside a macro body to the macro", () => {
        const target = prepareCallHierarchy(MAC_TEXT, macPos("target", 1), MAC_URI, noCrossFile)![0]!;
        const callers = incomingCalls(target, macRefs("target"), macGetText).map((c) => c.from.name);
        expect(callers).toEqual(["RUN"]);
    });
});
