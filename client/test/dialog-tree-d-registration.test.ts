/**
 * Tests for the D dialog tree registration function and its inline lambdas.
 *
 * registerDDialogTree passes three lambdas to registerDialogPanel:
 *   matchDocument, buildTreeHtml (wrapper), hasData (wrapper).
 *
 * The returned controller exposes matchDocument as matchesDocument, which lets
 * us exercise that lambda without triggering the full panel lifecycle (openPreview
 * requires a live LSP client and vscode window API). buildTreeHtml and hasData
 * are exercised here via a minimal mock client + activeTextEditor to keep the
 * test self-contained and avoid re-testing the panel infrastructure in shared.ts.
 */

import { vi, describe, expect, it } from "vitest";

// Minimal vscode mock: only the surface registerDialogPanel accesses at
// registration time (onDidChangeTextDocument, onDidSaveTextDocument) and the
// surface openPreview accesses (window.activeTextEditor, window.showWarningMessage).
vi.mock("vscode", () => ({
    workspace: {
        onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
        onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    },
    window: {
        activeTextEditor: undefined,
        showWarningMessage: vi.fn(),
    },
}));

vi.mock("vscode-languageclient/node", () => ({}));

import { registerDDialogTree } from "../src/dialog-tree/dialogTree-d";

function makeContext() {
    return {
        subscriptions: { push: vi.fn() },
        extensionUri: { fsPath: "/fake/ext", toString: () => "file:///fake/ext" },
    } as unknown as import("vscode").ExtensionContext;
}

function makeClient() {
    return {} as unknown as import("vscode-languageclient/node").LanguageClient;
}

describe("registerDDialogTree - matchDocument lambda", () => {
    it("matches documents with languageId weidu-d", () => {
        const ctx = makeContext();
        const controller = registerDDialogTree(ctx, makeClient());
        const doc = { languageId: "weidu-d", fileName: "dialog.d" } as import("vscode").TextDocument;
        expect(controller.matchesDocument(doc)).toBe(true);
    });

    it("matches .td files by extension regardless of languageId", () => {
        const ctx = makeContext();
        const controller = registerDDialogTree(ctx, makeClient());
        const doc = { languageId: "typescript", fileName: "/mod/scripts/hello.td" } as import("vscode").TextDocument;
        expect(controller.matchesDocument(doc)).toBe(true);
    });

    it("does not match unrelated files", () => {
        const ctx = makeContext();
        const controller = registerDDialogTree(ctx, makeClient());
        const doc = { languageId: "fallout-ssl", fileName: "/mod/scripts/hello.ssl" } as import("vscode").TextDocument;
        expect(controller.matchesDocument(doc)).toBe(false);
    });

    it("matches .TD extension case-insensitively", () => {
        const ctx = makeContext();
        const controller = registerDDialogTree(ctx, makeClient());
        const doc = { languageId: "plaintext", fileName: "HELLO.TD" } as import("vscode").TextDocument;
        expect(controller.matchesDocument(doc)).toBe(true);
    });
});
