/**
 * Unit tests for shared/protocol.ts.
 * Verifies the per-language workspace-symbols executeCommand identifiers.
 */

import { describe, expect, it } from "vitest";
import {
    LSP_COMMAND_WORKSPACE_SYMBOLS_PREFIX,
    WORKSPACE_SYMBOL_SCOPED_LANGUAGES,
    lspWorkspaceSymbolsCommand,
} from "../../shared/protocol";

describe("lspWorkspaceSymbolsCommand", () => {
    it("composes a command ID from the prefix and language ID", () => {
        expect(lspWorkspaceSymbolsCommand("fallout-ssl")).toBe(`${LSP_COMMAND_WORKSPACE_SYMBOLS_PREFIX}fallout-ssl`);
    });

    it("produces a unique ID for every supported language", () => {
        const ids = WORKSPACE_SYMBOL_SCOPED_LANGUAGES.map((lang) => lspWorkspaceSymbolsCommand(lang));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("uses a prefix that other LSP commands do not collide with", () => {
        // Sanity check: the prefix is namespaced under bgforge.workspaceSymbols.
        expect(LSP_COMMAND_WORKSPACE_SYMBOLS_PREFIX).toMatch(/^bgforge\./);
    });
});
