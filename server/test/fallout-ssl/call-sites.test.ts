/**
 * Unit tests for fallout-ssl parseFile() - reference extraction.
 * Tests that identifiers are collected and grouped by name for cross-file indexing.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeAll, vi } from "vitest";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    }),
    getDocuments: () => ({ get: vi.fn() }),
    initLspConnection: vi.fn(),
}));

import { initParser } from "../../src/fallout-ssl/parser";
import { parseFile } from "../../src/fallout-ssl/header-parser";

const TEST_URI = "file:///test.ssl";

beforeAll(async () => {
    await initParser();
});

describe("fallout-ssl/parseFile refs", () => {
    it("collects procedure name identifiers", () => {
        const text = `
procedure helper begin end
procedure main begin
    call helper;
end
`;
        const { refs } = parseFile(TEST_URI, text);
        const helperRefs = refs.get("helper");
        // "helper" appears in: procedure definition name + call site = 2
        expect(helperRefs).toBeDefined();
        expect(helperRefs!.length).toBeGreaterThanOrEqual(2);
    });

    it("collects macro identifiers", () => {
        const text = `
#define MAX_VAL 100
procedure foo begin
    if (x > MAX_VAL) then begin end
end
`;
        const { refs } = parseFile(TEST_URI, text);
        const maxRefs = refs.get("MAX_VAL");
        // Definition + usage
        expect(maxRefs).toBeDefined();
        expect(maxRefs!.length).toBeGreaterThanOrEqual(2);
    });

    it("returns correct URIs", () => {
        const text = `
procedure test begin end
`;
        const { refs } = parseFile(TEST_URI, text);
        const testRefs = refs.get("test");
        expect(testRefs).toBeDefined();
        for (const loc of testRefs!) {
            expect(loc.uri).toBe(TEST_URI);
        }
    });

    it("returns empty refs for empty text", () => {
        const { refs } = parseFile(TEST_URI, "");
        expect(refs.size).toBe(0);
    });

    it("collects identifiers used as function arguments (e.g. global_var(GVAR))", () => {
        const text = `
procedure start begin
    ndebug("global_var(GVAR_DEN_GANGWAR) == "+global_var(GVAR_DEN_GANGWAR));
end
`;
        const { refs } = parseFile(TEST_URI, text);
        const gvarRefs = refs.get("GVAR_DEN_GANGWAR");
        // GVAR_DEN_GANGWAR should appear as an Identifier in global_var(GVAR_DEN_GANGWAR)
        // Should NOT include the one inside the string literal
        expect(gvarRefs).toBeDefined();
        expect(gvarRefs!.length).toBe(1);
    });

    it("collects GVAR identifiers from real dclara.ssl fixture", () => {
        const sslPath = resolve(
            __dirname,
            "../../../external/fallout/Fallout2_Restoration_Project/scripts_src/den/dclara.ssl",
        );
        const text = readFileSync(sslPath, "utf-8");
        const { refs } = parseFile(TEST_URI, text);

        // GVAR_DEN_GANGWAR appears in global_var(GVAR_DEN_GANGWAR) at line 294
        // Should be collected as an Identifier ref
        const gvarRefs = refs.get("GVAR_DEN_GANGWAR");
        expect(gvarRefs, "GVAR_DEN_GANGWAR should appear in refs").toBeDefined();
        expect(gvarRefs!.length).toBeGreaterThanOrEqual(1);
    });

    it("returns both symbols and refs from single call", () => {
        const text = `
procedure my_proc begin
    call my_proc;
end
`;
        const result = parseFile(TEST_URI, text);
        // Symbols: should contain my_proc
        expect(result.symbols.length).toBeGreaterThanOrEqual(1);
        expect(result.symbols.some((s) => s.name === "my_proc")).toBe(true);
        // Refs: should contain my_proc identifiers
        const procRefs = result.refs.get("my_proc");
        expect(procRefs).toBeDefined();
        expect(procRefs!.length).toBeGreaterThanOrEqual(2);
    });
});
