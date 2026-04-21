/**
 * Unit tests for weidu-log/definition.ts - go to definition for mod paths in weidu.log.
 */

import * as fs from "fs";
import * as path from "path";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { Position } from "vscode-languageserver/node";
import { pathToUri } from "../../src/common";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { getDefinition } from "../../src/weidu-log/definition";

const tmpDir = path.join(process.cwd(), "tmp", "test-weidu-log-definition");

describe("weidu-log/definition", () => {
    const modDir = path.join(tmpDir, "ALTERNATIVES");
    const tp2File = path.join(modDir, "SETUP-ALTERNATIVES.TP2");
    const logFile = path.join(tmpDir, "weidu.log");
    const logUri = pathToUri(logFile);

    beforeAll(() => {
        fs.mkdirSync(modDir, { recursive: true });
        fs.writeFileSync(tp2File, "// mod installer\n");
        fs.writeFileSync(logFile, "");
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("navigates to .tp2 file from mod path", () => {
        const text = "~ALTERNATIVES/SETUP-ALTERNATIVES.TP2~ #0 #0 // Alternatives: v12";
        const position: Position = { line: 0, character: 10 };
        const result = getDefinition(text, logUri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(pathToUri(tp2File));
        expect(result?.range.start.line).toBe(0);
    });

    it("resolves paths case-insensitively", () => {
        const text = "~alternatives/setup-alternatives.tp2~ #0 #0 // Alternatives: v12";
        const position: Position = { line: 0, character: 10 };
        const result = getDefinition(text, logUri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(pathToUri(tp2File));
    });

    it("returns null when cursor is outside the path", () => {
        const text = "~ALTERNATIVES/SETUP-ALTERNATIVES.TP2~ #0 #0 // Alternatives: v12";
        // Cursor on "#0" after the closing ~
        const position: Position = { line: 0, character: 40 };
        const result = getDefinition(text, logUri, position);

        expect(result).toBeNull();
    });

    it("returns null when cursor is on the ~ delimiter", () => {
        const text = "~ALTERNATIVES/SETUP-ALTERNATIVES.TP2~ #0 #0 // Alternatives: v12";
        const position: Position = { line: 0, character: 0 };
        const result = getDefinition(text, logUri, position);

        expect(result).toBeNull();
    });

    it("returns null for non-existent mod path", () => {
        const text = "~NONEXISTENT/SETUP-FOO.TP2~ #0 #0 // foo";
        const position: Position = { line: 0, character: 5 };
        const result = getDefinition(text, logUri, position);

        expect(result).toBeNull();
    });

    it("handles multiple mod paths on separate lines", () => {
        const text = [
            "~FIRST/SETUP-FIRST.TP2~ #0 #0 // first",
            "~ALTERNATIVES/SETUP-ALTERNATIVES.TP2~ #0 #0 // Alternatives: v12",
        ].join("\n");
        const position: Position = { line: 1, character: 10 };
        const result = getDefinition(text, logUri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(pathToUri(tp2File));
    });

    it("returns null when cursor line is beyond the text (line 20 branch)", () => {
        const text = "~ALTERNATIVES/SETUP-ALTERNATIVES.TP2~ #0 #0 // Alternatives: v12";
        // Line 5 doesn't exist in single-line text
        const position: Position = { line: 5, character: 0 };
        const result = getDefinition(text, logUri, position);
        expect(result).toBeNull();
    });

    it("returns null when mod directory does not exist (readdirSync throws, line 76)", () => {
        const text = "~NO_SUCH_DIR/SETUP.TP2~ #0 #0 // missing";
        const position: Position = { line: 0, character: 5 };
        const result = getDefinition(text, logUri, position);
        // NO_SUCH_DIR doesn't exist so readdirSync throws → returns null
        expect(result).toBeNull();
    });

    it("returns null when resolved path is a directory not a file (line 90 branch)", () => {
        // The mod directory itself is not a file
        // Create a nested dir that resolves but isFile() returns false
        const nestedDir = path.join(tmpDir, "NESTED_MOD");
        fs.mkdirSync(nestedDir, { recursive: true });

        const text = `~NESTED_MOD~ #0 #0 // nested dir`;
        const position: Position = { line: 0, character: 5 };
        const result = getDefinition(text, logUri, position);
        // NESTED_MOD resolves to a directory, not a file → returns null
        expect(result).toBeNull();
    });
});
