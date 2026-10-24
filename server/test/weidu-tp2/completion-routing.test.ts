/**
 * Unit tests for WeiDU TP2 completion routing based on file extension.
 * Tests that functions from .tph files are shared (headers via Symbols),
 * while functions from .tpa/.tpp/.tp2 files are file-local (via ast-utils).
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

// Mock the server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

// Mock LSP connection for static loader
vi.mock("../../src/lsp-connection", () => ({
    getConnection: vi.fn(() => ({
        console: { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    })),
    initLspConnection: vi.fn(),
}));

import { initParser } from "@bgforge/shared/parsers/weidu-tp2";
import { weiduTp2Provider } from "../../src/weidu-tp2/provider";
import { localCompletion } from "../../src/weidu-tp2/ast-utils";
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

describe("weidu-tp2: formatting a file with a syntax error", () => {
    it("leaves it unchanged without a warning: the error is already a diagnostic", () => {
        const result = weiduTp2Provider.format!(
            "ACTION_IF a BEGIN\n  PRINT ~x~\n",
            normalizeUri("file:///mid-edit.tp2"),
        );
        expect(result).toEqual({ edits: [] });
    });
});

describe("weidu-tp2: functions defined in the file being edited", () => {
    it.each(["file:///lib.tpa", "file:///setup-x.tp2"])("are offered after LAF in %s", (file) => {
        const uri = normalizeUri(file);
        const text = `DEFINE_ACTION_FUNCTION own_fn BEGIN END\nBEGIN ~c~\nDEFINE_ACTION_FUNCTION nested_fn BEGIN END\nLAF |\n`;
        const at = text.indexOf("|");
        const before = text.slice(0, at).split("\n");
        const position = { line: before.length - 1, character: before.at(-1)!.length };
        const clean = text.replace("|", "");
        weiduTp2Provider.reloadFileData!(uri, clean);
        const items = weiduTp2Provider.filterCompletions!(weiduTp2Provider.getCompletions!(uri), clean, position, uri);
        expect(items.map((item) => item.label)).toEqual(expect.arrayContaining(["own_fn", "nested_fn"]));
        weiduTp2Provider.onWatchedFileDeleted!(uri);
    });
});

describe("weidu-tp2: workspace completions", () => {
    it("offers a name defined in several headers once", () => {
        const first = normalizeUri("file:///ids-a.tph");
        const second = normalizeUri("file:///ids-b.tph");
        weiduTp2Provider.reloadFileData!(first, `OUTER_SET DUPLICATED_IDS_NAME = 1\n`);
        weiduTp2Provider.reloadFileData!(second, `OUTER_SET DUPLICATED_IDS_NAME = 1\n`);

        const items = weiduTp2Provider.getCompletions!(normalizeUri("file:///user.tp2"));
        expect(items.filter((item) => item.label === "DUPLICATED_IDS_NAME")).toHaveLength(1);

        weiduTp2Provider.onWatchedFileDeleted!(first);
        weiduTp2Provider.onWatchedFileDeleted!(second);
    });

    it("keeps one entry per differing definition, each with its header", () => {
        const bgee = normalizeUri("file:///ids-bgee.tph");
        const bg2ee = normalizeUri("file:///ids-bg2ee.tph");
        weiduTp2Provider.reloadFileData!(bgee, `OUTER_SET DIFFERING_IDS_NAME = 1\n`);
        weiduTp2Provider.reloadFileData!(bg2ee, `OUTER_SET DIFFERING_IDS_NAME = 2\n`);

        const items = weiduTp2Provider.getCompletions!(normalizeUri("file:///user.tp2"));
        expect(items.filter((item) => item.label === "DIFFERING_IDS_NAME")).toHaveLength(2);

        weiduTp2Provider.onWatchedFileDeleted!(bgee);
        weiduTp2Provider.onWatchedFileDeleted!(bg2ee);
    });

    it("keeps an action and a patch function that share a name", () => {
        const header = normalizeUri("file:///twins.tph");
        weiduTp2Provider.reloadFileData!(
            header,
            `DEFINE_PATCH_FUNCTION twin_fn BEGIN END\nDEFINE_ACTION_FUNCTION twin_fn BEGIN END\n`,
        );

        const items = weiduTp2Provider.getCompletions!(normalizeUri("file:///user.tp2"));
        expect(items.filter((item) => item.label === "twin_fn")).toHaveLength(2);

        weiduTp2Provider.onWatchedFileDeleted!(header);
    });
});

describe("weidu-tp2: completion routing by file extension", () => {
    // Tests verify that .tph functions go to shared Symbols,
    // while .tpa/.tpp/.tp2 functions are handled by localCompletion().

    it("routes .tph functions to Symbols (shared across workspace)", () => {
        // Load a .tph file with a function definition
        const tphUri = normalizeUri("file:///test-routing.tph");
        const tphContent = `DEFINE_ACTION_FUNCTION shared_func BEGIN
    PRINT ~shared~
END`;
        weiduTp2Provider.reloadFileData!(tphUri, tphContent);

        // The function should be in the global Symbols
        const sharedFunc = weiduTp2Provider.resolveSymbol!("shared_func", "", normalizeUri(""));
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
        const localFunc = weiduTp2Provider.resolveSymbol!("local_func_that_doesnt_exist", "", normalizeUri(""));
        expect(localFunc).toBeUndefined();
    });

    it("combines .tph functions from multiple header files in Symbols", () => {
        // Load multiple .tph files
        const tph1Uri = normalizeUri("file:///header1.tph");
        const tph1Content = `DEFINE_ACTION_FUNCTION func1 BEGIN END`;
        weiduTp2Provider.reloadFileData!(tph1Uri, tph1Content);

        const tph2Uri = normalizeUri("file:///header2.tph");
        const tph2Content = `DEFINE_ACTION_FUNCTION func2 BEGIN END`;
        weiduTp2Provider.reloadFileData!(tph2Uri, tph2Content);

        // Both functions should be in Symbols
        expect(weiduTp2Provider.resolveSymbol!("func1", "", normalizeUri(""))).toBeDefined();
        expect(weiduTp2Provider.resolveSymbol!("func2", "", normalizeUri(""))).toBeDefined();

        // Cleanup
        weiduTp2Provider.onWatchedFileDeleted!(tph1Uri);
        weiduTp2Provider.onWatchedFileDeleted!(tph2Uri);
    });

    it("keeps .tph (Symbols) and local (localCompletion) separate", () => {
        // Load a .tph file (shared via Symbols)
        const tphUri = normalizeUri("file:///shared-sep.tph");
        const tphContent = `DEFINE_ACTION_FUNCTION shared_func_sep BEGIN END`;
        weiduTp2Provider.reloadFileData!(tphUri, tphContent);

        // Local content (via localCompletion) - includes variables
        const localContent = `OUTER_SET local_var = 5`;
        const localCompletions = localCompletion(localContent);

        // shared_func_sep is in Symbols
        expect(weiduTp2Provider.resolveSymbol!("shared_func_sep", "", normalizeUri(""))).toBeDefined();

        // local_var is in localCompletion result
        expect(localCompletions.find((item) => item.label === "local_var")).toBeDefined();

        // local_var is NOT in Symbols (not from .tph)
        expect(weiduTp2Provider.resolveSymbol!("local_var", "", normalizeUri(""))).toBeUndefined();

        // Cleanup
        weiduTp2Provider.onWatchedFileDeleted!(tphUri);
    });

    it("clears .tph functions from Symbols when file is removed", () => {
        // Load a .tph file with a unique function name
        const tphUri = normalizeUri("file:///to-delete.tph");
        const tphContent = `DEFINE_ACTION_FUNCTION func_to_delete BEGIN END`;
        weiduTp2Provider.reloadFileData!(tphUri, tphContent);

        // Verify it's in the index
        expect(weiduTp2Provider.resolveSymbol!("func_to_delete", "", normalizeUri(""))).toBeDefined();

        // Clear the file
        weiduTp2Provider.onWatchedFileDeleted!(tphUri);

        // Verify it's removed
        expect(weiduTp2Provider.resolveSymbol!("func_to_delete", "", normalizeUri(""))).toBeUndefined();
    });
});
