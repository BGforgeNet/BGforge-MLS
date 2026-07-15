import { describe, expect, it, beforeAll, vi } from "vitest";
vi.mock("../../src/server", () => ({
    connection: { console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }, sendDiagnostics: vi.fn() },
}));

import { detectEmbeddedBaf } from "../../src/weidu-d/embedded-baf";
import { initParser } from "../../../shared/parsers/weidu-d";
import type { Position } from "vscode-languageserver/node";

beforeAll(async () => {
    await initParser();
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
