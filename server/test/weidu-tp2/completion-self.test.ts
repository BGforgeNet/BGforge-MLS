/**
 * Tests for self-completion prevention in WeiDU TP2.
 * Verifies that phantom assignments from tree-sitter error recovery
 * don't produce spurious local variable completions.
 *
 * Bug: When typing a partial keyword like COPY_EXISTN (incomplete COPY_EXISTING),
 * tree-sitter error recovery creates a phantom patch_assignment node with a
 * zero-width "=" operator, making it look like a variable assignment.
 * This causes 3 bugs:
 *   1. Self-completion: the word being typed is offered as a completion
 *   2. Type mismatch: shown as "int" but value is a string (~delon.bcs~)
 *   3. Non-existent symbol: no OUTER_SET/SPRINT defines this variable
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

import { initParser, parseWithCache } from "../../../shared/parsers/weidu-tp2";
import { localCompletion } from "../../src/weidu-tp2/ast-utils";
import { parseHeaderVariables } from "../../src/weidu-tp2/header-parser";
import { isPhantomAssignment } from "../../src/weidu-tp2/tree-utils";
import { weiduTp2Provider } from "../../src/weidu-tp2/provider";
import { defaultSettings } from "../../src/settings";
import { CompletionItemKind } from "vscode-languageserver/node";
import * as path from "path";

beforeAll(async () => {
    await initParser();
    await weiduTp2Provider.init?.({
        workspaceRoot: path.resolve(__dirname, "..", "src"),
        settings: defaultSettings,
    });
});

describe("weidu-tp2: phantom assignment rejection", () => {
    // Tree-sitter error recovery creates patch_assignment from broken keywords
    // e.g. "COPY_EXISTN ~delon.bcs~" becomes patch_assignment with phantom "="

    it("should NOT extract variables from broken COPY_EXISTING (partial keyword)", () => {
        const text = `COPY_EXISTN ~delon.bcs~ ~override~
  DECOMPILE_AND_PATCH BEGIN
    REPLACE_TEXTUALLY ~foo~ ~bar~
  END`;
        const completions = localCompletion(text);
        const fake = completions.find((c) => c.label === "COPY_EXISTN");
        expect(fake).toBeUndefined();
    });

    it("should NOT extract header variables from broken COPY_EXISTING", () => {
        const text = `COPY_EXISTN ~delon.bcs~ ~override~
  DECOMPILE_AND_PATCH BEGIN
    REPLACE_TEXTUALLY ~foo~ ~bar~
  END`;
        const vars = parseHeaderVariables(text, "file:///test.tp2");
        const fake = vars.find((v) => v.name === "COPY_EXISTN");
        expect(fake).toBeUndefined();
    });

    it("should still extract real variables from OUTER_SET", () => {
        const text = `OUTER_SET my_var = 42`;
        const completions = localCompletion(text);
        expect(completions.find((c) => c.label === "my_var")).toBeDefined();
    });

    it("should still extract real variables from OUTER_SPRINT", () => {
        const text = `OUTER_SPRINT my_str ~hello~`;
        const vars = parseHeaderVariables(text, "file:///test.tp2");
        expect(vars.find((v) => v.name === "my_str")).toBeDefined();
    });

    it("should still extract real patch_assignment variables (bare SET)", () => {
        // In .tpp context, bare assignments like "foo = 5" are valid
        const text = `foo = 5`;
        const completions = localCompletion(text);
        expect(completions.find((c) => c.label === "foo")).toBeDefined();
    });

    it("should NOT extract variables from other broken keywords", () => {
        // Test with various partial/misspelled keywords
        const text = `COPY_EXISTIN ~file.bcs~ ~override~`;
        const completions = localCompletion(text);
        const fake = completions.find((c) => c.label === "COPY_EXISTIN");
        expect(fake).toBeUndefined();
    });

    it("should NOT extract variables from broken APPEND keyword", () => {
        const text = `APPEN ~file.2da~ ~row data~`;
        const completions = localCompletion(text);
        const fake = completions.find((c) => c.label === "APPEN");
        expect(fake).toBeUndefined();
    });

    it("should NOT extract variables with correct COPY_EXISTING", () => {
        const text = `COPY_EXISTING ~delon.bcs~ ~override~
  DECOMPILE_AND_PATCH BEGIN
    REPLACE_TEXTUALLY ~foo~ ~bar~
  END`;
        const completions = localCompletion(text);
        expect(completions).toHaveLength(0);
    });
});

describe("weidu-tp2: self-completion exclusion in general path", () => {
    // Defense-in-depth: even if a local variable somehow matches the word being
    // typed, filterCompletions should exclude it. This protects against future
    // error recovery patterns that might bypass phantom assignment detection.

    it("should exclude current word from local completions in general path", () => {
        // File has a real variable "my_var". User is typing "my_var" somewhere
        // in a non-declaration context. The word should not self-complete.
        const text = `OUTER_SET my_var = 5
my_var`;
        const uri = "file:///test-self.tp2";
        // Cursor at end of line 1 (0-indexed), on "my_var"
        const position = { line: 1, character: 6 };

        const base = weiduTp2Provider.getCompletions!(uri);
        const filtered = weiduTp2Provider.filterCompletions!(base, text, position, uri);

        const selfItem = filtered.find((c) => c.label === "my_var" && c.kind === CompletionItemKind.Variable);
        expect(selfItem).toBeUndefined();
    });

    it("should still show other local variables when one is excluded", () => {
        const text = `OUTER_SET alpha = 1
OUTER_SET beta = 2
alpha`;
        const uri = "file:///test-self2.tp2";
        // Cursor on "alpha" at line 2
        const position = { line: 2, character: 5 };

        const base = weiduTp2Provider.getCompletions!(uri);
        const filtered = weiduTp2Provider.filterCompletions!(base, text, position, uri);

        // "alpha" should be excluded (current word), "beta" should remain
        const alpha = filtered.find((c) => c.label === "alpha" && c.kind === CompletionItemKind.Variable);
        const beta = filtered.find((c) => c.label === "beta" && c.kind === CompletionItemKind.Variable);
        expect(alpha).toBeUndefined();
        expect(beta).toBeDefined();
    });
});

describe("weidu-tp2: isPhantomAssignment direct unit tests", () => {
    // Direct tests for the isPhantomAssignment utility itself, independent of
    // the downstream consumers (localCompletion, parseHeaderVariables).
    // If isPhantomAssignment breaks, these tests pinpoint the failure to the
    // utility rather than leaving it ambiguous between detector and caller.

    /** Helper: find the first node of a given type in the AST. */
    function findNodeByType(root: import("web-tree-sitter").Node, type: string): import("web-tree-sitter").Node | null {
        if (root.type === type) return root;
        for (const child of root.children) {
            const found = findNodeByType(child, type);
            if (found) return found;
        }
        return null;
    }

    it("should detect phantom patch_assignment from broken keyword", () => {
        // "COPY_EXISTN ~delon.bcs~" -> patch_assignment with zero-width "="
        const tree = parseWithCache("COPY_EXISTN ~delon.bcs~ ~override~");
        expect(tree!).not.toBeNull();
        const node = findNodeByType(tree!.rootNode, "patch_assignment");
        expect(node).not.toBeNull();
        expect(isPhantomAssignment(node!)).toBe(true);
    });

    it("should accept real patch_assignment with actual = operator", () => {
        const tree = parseWithCache("foo = 5");
        expect(tree!).not.toBeNull();
        const node = findNodeByType(tree!.rootNode, "patch_assignment");
        expect(node).not.toBeNull();
        expect(isPhantomAssignment(node!)).toBe(false);
    });

    it("should accept real patch_assignment with compound operator", () => {
        const tree = parseWithCache("foo += 3");
        expect(tree!).not.toBeNull();
        const node = findNodeByType(tree!.rootNode, "patch_assignment");
        expect(node).not.toBeNull();
        expect(isPhantomAssignment(node!)).toBe(false);
    });

    it("should return false for non-assignment node types", () => {
        // OUTER_SET produces action_outer_set, not patch_assignment.
        // isPhantomAssignment should return false (not applicable).
        const tree = parseWithCache("OUTER_SET x = 1");
        expect(tree!).not.toBeNull();
        const node = findNodeByType(tree!.rootNode, "action_outer_set");
        expect(node).not.toBeNull();
        expect(isPhantomAssignment(node!)).toBe(false);
    });

    it("should detect phantom from single-char broken identifier", () => {
        // Even a single-character identifier can produce a phantom assignment
        const tree = parseWithCache("C ~file~");
        expect(tree!).not.toBeNull();
        const node = findNodeByType(tree!.rootNode, "patch_assignment");
        expect(node).not.toBeNull();
        expect(isPhantomAssignment(node!)).toBe(true);
    });

    it("should detect phantom when value is a number", () => {
        // "FOO 42" — broken keyword with numeric value
        const tree = parseWithCache("FOO 42");
        expect(tree!).not.toBeNull();
        const node = findNodeByType(tree!.rootNode, "patch_assignment");
        expect(node).not.toBeNull();
        expect(isPhantomAssignment(node!)).toBe(true);
    });
});
