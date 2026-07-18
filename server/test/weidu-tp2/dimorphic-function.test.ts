/**
 * DEFINE_DIMORPHIC_FUNCTION support. A dimorphic function parses as a function
 * definition (grammar), so it is navigable, and - being launchable via BOTH
 * LAF and LPF - go-to-definition resolves from either launch form, and it is
 * offered in both launch-completion contexts.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import type { Position } from "vscode-languageserver/node";

vi.mock("../../src/server", () => ({
    connection: { console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }, sendDiagnostics: vi.fn() },
}));
vi.mock("../../src/lsp-connection", () => ({
    getConnection: vi.fn(() => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    })),
    initLspConnection: vi.fn(),
}));
vi.mock("../../src/path-utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/path-utils")>();
    return { ...actual, isSubpath: vi.fn(() => true) };
});

import { getDefinition } from "../../src/weidu-tp2/definition";
import { weiduTp2Provider } from "../../src/weidu-tp2/provider";
import { initParser } from "../../../shared/parsers/weidu-tp2";
import { defaultSettings } from "../../src/settings";
import { normalizeUri } from "../../src/core/normalized-uri";
import * as path from "path";

beforeAll(async () => {
    await initParser();
    await weiduTp2Provider.init?.({
        workspaceRoot: path.resolve(__dirname, "..", "src"),
        settings: defaultSettings,
    });
});

/** Split a `|`-marked string into text + the cursor Position where `|` was. */
function cursor(marked: string): { text: string; position: Position } {
    const idx = marked.indexOf("|");
    if (idx === -1) throw new Error("no cursor marker");
    const before = marked.slice(0, idx);
    const lines = before.split("\n");
    return {
        text: before + marked.slice(idx + 1),
        position: { line: lines.length - 1, character: lines[lines.length - 1]!.length },
    };
}

const DEF = `DEFINE_DIMORPHIC_FUNCTION my_dim
BEGIN
  PRINT ~hi~
END`;
// "my_dim" begins right after "DEFINE_DIMORPHIC_FUNCTION " (25 chars + 1 space).
const DEF_NAME_CHAR = 26;

describe("TP2 dimorphic functions", () => {
    it("go-to-definition resolves from a LAF launch to the DEFINE", () => {
        const { text, position } = cursor(`${DEF}\nLAF my|_dim END\n`);
        const result = getDefinition(text, "file:///test.tp2", position);
        expect(result).not.toBeNull();
        expect(result?.range.start.line).toBe(0);
        expect(result?.range.start.character).toBe(DEF_NAME_CHAR);
    });

    it("go-to-definition resolves from a LPF launch to the DEFINE (launchable both ways)", () => {
        const { text, position } = cursor(`${DEF}\nCOPY ~a~ ~b~\n  LPF my|_dim END\n`);
        const result = getDefinition(text, "file:///test.tp2", position);
        expect(result).not.toBeNull();
        expect(result?.range.start.line).toBe(0);
        expect(result?.range.start.character).toBe(DEF_NAME_CHAR);
    });

    it("is offered in BOTH LAF and LPF completion contexts", () => {
        const headerUri = normalizeUri("file:///dim.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, `${DEF}\n`);

        const uri = normalizeUri("file:///test.tp2");
        const laf = cursor(`INCLUDE ~dim.tph~\nLAF my|\n`);
        const lpf = cursor(`INCLUDE ~dim.tph~\nCOPY ~a~ ~b~\n  LPF my|\n`);

        const all = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const inLaf = weiduTp2Provider.filterCompletions?.(all, laf.text, laf.position, uri) ?? [];
        const inLpf = weiduTp2Provider.filterCompletions?.(all, lpf.text, lpf.position, uri) ?? [];

        expect(inLaf.some((i) => i.label === "my_dim")).toBe(true);
        expect(inLpf.some((i) => i.label === "my_dim")).toBe(true);
    });

    it("provides a folding range over the dimorphic function block", () => {
        const ranges = weiduTp2Provider.foldingRanges?.(`${DEF}\n`) ?? [];
        expect(ranges.some((r) => r.startLine === 0)).toBe(true);
    });
});
