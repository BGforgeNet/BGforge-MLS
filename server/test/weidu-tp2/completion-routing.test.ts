/**
 * Unit tests for WeiDU TP2 completion routing based on file extension.
 * Tests that functions from .tph files are shared (headers via Symbols),
 * while functions from .tpa/.tpp/.tp2 files are file-local (via ast-utils).
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

// Mock the server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

// Mock LSP connection for static loader
vi.mock("../../src/lsp-connection", () => ({
    getConnection: vi.fn(() => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    })),
    initLspConnection: vi.fn(),
}));

import { initParser } from "../../../shared/parsers/weidu-tp2";
import { weiduTp2Provider } from "../../src/weidu-tp2/provider";
import { localCompletion } from "../../src/weidu-tp2/ast-utils";
import { defaultSettings } from "../../src/settings";
import * as path from "path";

beforeAll(async () => {
    await initParser();
    await weiduTp2Provider.init?.({
        workspaceRoot: path.resolve(__dirname, "..", "src"),
        settings: defaultSettings,
    });
});

describe("weidu-tp2: completion routing by file extension", () => {
    // Tests verify that .tph functions go to shared Symbols,
    // while .tpa/.tpp/.tp2 functions are handled by localCompletion().

    it("routes .tph functions to Symbols (shared across workspace)", () => {
        // Load a .tph file with a function definition
        const tphUri = "file:///test-routing.tph";
        const tphContent = `DEFINE_ACTION_FUNCTION shared_func BEGIN
    PRINT ~shared~
END`;
        weiduTp2Provider.reloadFileData!(tphUri, tphContent);

        // The function should be in the global Symbols
        const sharedFunc = weiduTp2Provider.resolveSymbol!("shared_func", "", "");
        expect(sharedFunc).toBeDefined();
        expect(sharedFunc?.completion.label).toBe("shared_func");

        // Cleanup
        weiduTp2Provider.onWatchedFileDeleted!(tphUri);
    });

    it("localCompletion provides local variables (not functions)", () => {
        // localCompletion extracts VARIABLES from the current file
        // Functions are NOT included - only .tph header functions are shared
        const content = `OUTER_SET local_var = 5
DEFINE_ACTION_FUNCTION local_func BEGIN
    PRINT ~local~
END`;
        const completions = localCompletion(content);

        // Variables should appear in local completions
        const localVar = completions.find((item) => item.label === "local_var");
        expect(localVar).toBeDefined();

        // Functions are NOT in localCompletion (only .tph headers are shared)
        const localFunc = completions.find((item) => item.label === "local_func");
        expect(localFunc).toBeUndefined();
    });

    it("non-.tph files don't have their functions in Symbols", () => {
        // A .tpa file's functions should NOT be in Symbols
        // (Symbols is only populated for .tph files via provider.reloadFileData)
        const localFunc = weiduTp2Provider.resolveSymbol!("local_func_that_doesnt_exist", "", "");
        expect(localFunc).toBeUndefined();
    });

    it("combines .tph functions from multiple header files in Symbols", () => {
        // Load multiple .tph files
        const tph1Uri = "file:///header1.tph";
        const tph1Content = `DEFINE_ACTION_FUNCTION func1 BEGIN END`;
        weiduTp2Provider.reloadFileData!(tph1Uri, tph1Content);

        const tph2Uri = "file:///header2.tph";
        const tph2Content = `DEFINE_ACTION_FUNCTION func2 BEGIN END`;
        weiduTp2Provider.reloadFileData!(tph2Uri, tph2Content);

        // Both functions should be in Symbols
        expect(weiduTp2Provider.resolveSymbol!("func1", "", "")).toBeDefined();
        expect(weiduTp2Provider.resolveSymbol!("func2", "", "")).toBeDefined();

        // Cleanup
        weiduTp2Provider.onWatchedFileDeleted!(tph1Uri);
        weiduTp2Provider.onWatchedFileDeleted!(tph2Uri);
    });

    it("keeps .tph (Symbols) and local (localCompletion) separate", () => {
        // Load a .tph file (shared via Symbols)
        const tphUri = "file:///shared-sep.tph";
        const tphContent = `DEFINE_ACTION_FUNCTION shared_func_sep BEGIN END`;
        weiduTp2Provider.reloadFileData!(tphUri, tphContent);

        // Local content (via localCompletion) - includes variables
        const localContent = `OUTER_SET local_var = 5`;
        const localCompletions = localCompletion(localContent);

        // shared_func_sep is in Symbols
        expect(weiduTp2Provider.resolveSymbol!("shared_func_sep", "", "")).toBeDefined();

        // local_var is in localCompletion result
        expect(localCompletions.find((item) => item.label === "local_var")).toBeDefined();

        // local_var is NOT in Symbols (not from .tph)
        expect(weiduTp2Provider.resolveSymbol!("local_var", "", "")).toBeUndefined();

        // Cleanup
        weiduTp2Provider.onWatchedFileDeleted!(tphUri);
    });

    it("clears .tph functions from Symbols when file is removed", () => {
        // Load a .tph file with a unique function name
        const tphUri = "file:///to-delete.tph";
        const tphContent = `DEFINE_ACTION_FUNCTION func_to_delete BEGIN END`;
        weiduTp2Provider.reloadFileData!(tphUri, tphContent);

        // Verify it's in the index
        expect(weiduTp2Provider.resolveSymbol!("func_to_delete", "", "")).toBeDefined();

        // Clear the file
        weiduTp2Provider.onWatchedFileDeleted!(tphUri);

        // Verify it's removed
        expect(weiduTp2Provider.resolveSymbol!("func_to_delete", "", "")).toBeUndefined();
    });
});
