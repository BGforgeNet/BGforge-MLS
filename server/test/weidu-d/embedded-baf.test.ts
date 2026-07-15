import { describe, expect, it, beforeAll, vi } from "vitest";
vi.mock("../../src/logger", () => ({
    conlog: vi.fn(),
}));

// Unit tests import source, where loadStaticSymbols resolves the completion JSON relative to __dirname
// (src/core) and finds nothing - the built artifact lives in out/. Mock it with representative BAF symbols
// (real names and kinds) so the kind-filtering, case-folding, and resolution logic is exercised
// deterministically. Real BAF data is exercised end-to-end by the code-server live drive. `kind` uses the
// SymbolKind string values ("trigger"/"action") that production code compares against.
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
        {
            // An IDS/keyword constant - an argument value (e.g. a slots.ids or EA.ids symbol). These are
            // kind Constant, not Trigger/Action, and appear in argument positions of any call.
            name: "SLOT_WEAPON",
            kind: "constant",
            location: null,
            scope: { level: 0 },
            source: { type: 0, uri: null },
            completion: { label: "SLOT_WEAPON", kind: 21 },
            hover: { contents: { kind: "markdown", value: "SLOT_WEAPON - slots.ids" } },
        },
    ]),
}));

import {
    detectEmbeddedBaf,
    initEmbeddedBaf,
    resolveEmbeddedBafSymbol,
    getEmbeddedBafCompletions,
} from "../../src/weidu-d/embedded-baf";
import { initParser } from "../../../shared/parsers/weidu-d";
import type { Position } from "vscode-languageserver/node";

beforeAll(async () => {
    await initParser();
    initEmbeddedBaf();
});

/** Position just inside the first occurrence of `token` on the given 0-based line. */
function cursorAt(lines: string[], line: number, token: string): Position {
    const source = lines[line];
    if (source === undefined) throw new Error(`no line ${line}`);
    const idx = source.indexOf(token);
    if (idx === -1) throw new Error(`token ${token} not on line ${line}`);
    return { line, character: idx + 1 };
}

describe("detectEmbeddedBaf", () => {
    const stateLines = [
        "BEGIN ~DLG~",
        "",
        'IF ~Acquired("SW1H01","GLOBAL",1)~ THEN BEGIN greeting',
        "    SAY ~Hello there~",
        "    IF ~~ THEN DO ~ActionOverride(Myself,Attack(Player1))~ GOTO greeting",
        "END",
    ];
    const stateText = stateLines.join("\n");

    it("returns 'trigger' inside a state IF trigger string", () => {
        expect(detectEmbeddedBaf(stateText, cursorAt(stateLines, 2, "Acquired"))).toBe("trigger");
    });

    it("returns 'action' inside a DO action string", () => {
        expect(detectEmbeddedBaf(stateText, cursorAt(stateLines, 4, "ActionOverride"))).toBe("action");
    });

    it("returns 'trigger' inside an IF condition string (d_action_when)", () => {
        // REPLACE_TRIGGER_TEXT file ~old~ ~new~ [IF ~condition~] - the condition field is the only
        // grammar site named "condition"; it shares the trigger vocabulary.
        const lines = ["REPLACE_TRIGGER_TEXT ~myfile~ ~old~ ~new~", '  IF ~Global("y","GLOBAL",0)~'];
        expect(detectEmbeddedBaf(lines.join("\n"), cursorAt(lines, 1, "Global"))).toBe("trigger");
    });

    it("returns null inside SAY dialogue text", () => {
        expect(detectEmbeddedBaf(stateText, cursorAt(stateLines, 3, "Hello"))).toBeNull();
    });

    it("returns null on a state label", () => {
        expect(detectEmbeddedBaf(stateText, cursorAt(stateLines, 2, "greeting"))).toBeNull();
    });

    it("returns null inside a comment", () => {
        const lines = ["BEGIN ~DLG~", "// Acquired here is prose", "IF ~~ THEN BEGIN s SAY ~x~ END"];
        expect(detectEmbeddedBaf(lines.join("\n"), cursorAt(lines, 1, "Acquired"))).toBeNull();
    });

    it("returns null on the THEN keyword (outside any string)", () => {
        expect(detectEmbeddedBaf(stateText, cursorAt(stateLines, 2, "THEN"))).toBeNull();
    });
});

describe("embedded BAF symbol access", () => {
    it("resolves a known BAF trigger", () => {
        expect(resolveEmbeddedBafSymbol("Acquired")?.completion.label).toBe("Acquired");
    });

    it("resolves case-insensitively (baflexer folds case)", () => {
        expect(resolveEmbeddedBafSymbol("acquired")?.name).toBe("Acquired");
        expect(resolveEmbeddedBafSymbol("ACTIONOVERRIDE")?.name).toBe("ActionOverride");
    });

    it("returns undefined for a non-BAF word", () => {
        expect(resolveEmbeddedBafSymbol("NotABafSymbol")).toBeUndefined();
    });

    it("offers triggers and argument constants, but not actions, for a trigger field", () => {
        const labels = getEmbeddedBafCompletions("trigger").map((c) => c.label);
        expect(labels).toContain("Acquired"); // the field-scoped callable
        expect(labels).toContain("SLOT_WEAPON"); // IDS/keyword constant (argument value), as in the .baf editor
        expect(labels).not.toContain("ActionOverride"); // opposite callable excluded
    });

    it("offers actions and argument constants, but not triggers, for an action field", () => {
        const labels = getEmbeddedBafCompletions("action").map((c) => c.label);
        expect(labels).toContain("ActionOverride");
        expect(labels).toContain("SLOT_WEAPON");
        expect(labels).not.toContain("Acquired");
    });
});
