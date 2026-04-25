/**
 * Integration tests for header loading at provider initialization.
 *
 * Verifies that .tph files in the workspace are scanned and indexed
 * at startup, making their functions available for completion/hover/definition.
 *
 * Tests use the Symbols class (unified source of truth) rather than
 * the legacy function/variable indices.
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { pathToFileURL } from "url";

// Mock server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { parseFile } from "../../src/weidu-tp2/header-parser";

/** Extract symbols only (convenience wrapper). */
const parseHeaderToSymbols = (...args: Parameters<typeof parseFile>) => [...parseFile(...args).symbols];
import { initParser } from "../../../shared/parsers/weidu-tp2";
import { Symbols } from "../../src/core/symbol-index";
import { normalizeUri } from "../../src/core/normalized-uri";
import { isCallableSymbol } from "../../src/core/symbol";

// Initialize tree-sitter parser before tests (required for header parsing)
beforeAll(async () => {
    await initParser();
});

describe("TP2 header loading integration", () => {
    const testHeaderContent = `
DEFINE_ACTION_FUNCTION unstack_armor_bonus
    INT_VAR
        bonus = 0
    STR_VAR
        item = ""
BEGIN
    // Function body
END

DEFINE_PATCH_FUNCTION apply_bonus
    INT_VAR value = 1
BEGIN
END
`;

    let store: Symbols;

    beforeEach(() => {
        store = new Symbols();
    });

    describe("function lookup via Symbols", () => {
        it("parses function parameters", () => {
            const uri = "file:///test.tph";
            const parsedSymbols = parseHeaderToSymbols(uri, testHeaderContent);
            store.updateFile(normalizeUri(uri), parsedSymbols);

            const func = store.lookup("unstack_armor_bonus");
            expect(func).toBeDefined();
            expect(isCallableSymbol(func!)).toBe(true);
            if (isCallableSymbol(func!)) {
                expect(func.callable.params?.intVar).toHaveLength(1);
                expect(func.callable.params?.intVar[0]!.name).toBe("bonus");
                expect(func.callable.params?.strVar).toHaveLength(1);
                expect(func.callable.params?.strVar[0]!.name).toBe("item");
            }
        });

        it("indexes multiple functions from same file", () => {
            const uri = "file:///test.tph";
            const parsedSymbols = parseHeaderToSymbols(uri, testHeaderContent);
            store.updateFile(normalizeUri(uri), parsedSymbols);

            expect(store.lookup("unstack_armor_bonus")).toBeDefined();
            expect(store.lookup("apply_bonus")).toBeDefined();
        });

        it("preserves function location information", () => {
            const uri = "file:///test.tph";
            const parsedSymbols = parseHeaderToSymbols(uri, testHeaderContent);
            store.updateFile(normalizeUri(uri), parsedSymbols);

            const func = store.lookup("unstack_armor_bonus");
            expect(func?.location!.uri).toBe(uri);
            expect(func?.location!.range.start.line).toBe(1);
        });

        it("updates existing function when file is reindexed", () => {
            const uri = "file:///test.tph";

            // Index original content
            const parsedSymbols1 = parseHeaderToSymbols(uri, testHeaderContent);
            store.updateFile(normalizeUri(uri), parsedSymbols1);
            expect(store.lookup("unstack_armor_bonus")).toBeDefined();

            // Update with new content
            const newContent = `DEFINE_ACTION_FUNCTION new_function BEGIN END`;
            const parsedSymbols2 = parseHeaderToSymbols(uri, newContent);
            store.updateFile(normalizeUri(uri), parsedSymbols2);

            expect(store.lookup("unstack_armor_bonus")).toBeUndefined();
            expect(store.lookup("new_function")).toBeDefined();
        });

        it("clears functions when file is removed", () => {
            const uri = "file:///test.tph";

            // Index file
            const parsedSymbols = parseHeaderToSymbols(uri, testHeaderContent);
            store.updateFile(normalizeUri(uri), parsedSymbols);
            expect(store.lookup("unstack_armor_bonus")).toBeDefined();

            // Clear file
            store.clearFile(normalizeUri(uri));
            expect(store.lookup("unstack_armor_bonus")).toBeUndefined();
        });

        it("preserves functions from other files on clear", () => {
            // Index two files
            const uri1 = "file:///test1.tph";
            const uri2 = "file:///test2.tph";
            const content2 = `DEFINE_ACTION_FUNCTION other_func BEGIN END`;

            const parsedSymbols1 = parseHeaderToSymbols(uri1, testHeaderContent);
            store.updateFile(normalizeUri(uri1), parsedSymbols1);

            const parsedSymbols2 = parseHeaderToSymbols(uri2, content2);
            store.updateFile(normalizeUri(uri2), parsedSymbols2);

            // Clear only first file
            store.clearFile(normalizeUri(uri1));

            expect(store.lookup("unstack_armor_bonus")).toBeUndefined();
            expect(store.lookup("other_func")).toBeDefined();
        });
    });

    describe("file watching scenarios", () => {
        let tempDir: string;

        beforeEach(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "header-test-"));
        });

        afterEach(() => {
            fs.rmSync(tempDir, { recursive: true, force: true });
        });

        it("indexes file after creation", () => {
            const filePath = path.join(tempDir, "new.tph");
            fs.writeFileSync(filePath, testHeaderContent);

            const uri = pathToFileURL(filePath).href;
            const text = fs.readFileSync(filePath, "utf8");
            const parsedSymbols = parseHeaderToSymbols(uri, text);
            store.updateFile(normalizeUri(uri), parsedSymbols);

            const func = store.lookup("unstack_armor_bonus");
            expect(func).toBeDefined();
            expect(func?.location!.uri).toBe(uri);
        });
    });
});
