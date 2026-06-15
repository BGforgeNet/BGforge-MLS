/**
 * Tests for the SSL dialog tree registration function and its inline lambdas.
 *
 * registerDialogTree passes three lambdas to registerDialogPanel:
 *   matchDocument, buildTreeHtml (wrapper), hasData (wrapper).
 *
 * The returned controller exposes matchDocument as matchesDocument, exercisable
 * without a full panel lifecycle. buildTreeHtml and hasData are single-expression
 * wrappers over already-tested functions; they are skipped here because exercising
 * them requires triggering openPreview with a mocked LSP client and live vscode
 * window state, which would be re-testing the panel infrastructure rather than
 * the SSL-specific logic.
 */

import { vi, describe, expect, it } from "vitest";

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

import { registerDialogTree } from "../src/dialog-tree/dialogTree";

function makeContext() {
    return {
        subscriptions: { push: vi.fn() },
        extensionUri: { fsPath: "/fake/ext", toString: () => "file:///fake/ext" },
    } as unknown as import("vscode").ExtensionContext;
}

function makeClient() {
    return {} as unknown as import("vscode-languageclient/node").LanguageClient;
}

describe("registerDialogTree - matchDocument lambda", () => {
    it("matches documents with languageId fallout-ssl", () => {
        const ctx = makeContext();
        const controller = registerDialogTree(ctx, makeClient());
        const doc = { languageId: "fallout-ssl", fileName: "script.ssl" } as import("vscode").TextDocument;
        expect(controller.matchesDocument(doc)).toBe(true);
    });

    it("matches .tssl files by extension regardless of languageId", () => {
        const ctx = makeContext();
        const controller = registerDialogTree(ctx, makeClient());
        const doc = { languageId: "typescript", fileName: "/mod/src/mycutscene.tssl" } as import("vscode").TextDocument;
        expect(controller.matchesDocument(doc)).toBe(true);
    });

    it("does not match unrelated files", () => {
        const ctx = makeContext();
        const controller = registerDialogTree(ctx, makeClient());
        const doc = { languageId: "weidu-d", fileName: "/mod/dialog/npc.d" } as import("vscode").TextDocument;
        expect(controller.matchesDocument(doc)).toBe(false);
    });

    it("matches .TSSL extension case-insensitively", () => {
        const ctx = makeContext();
        const controller = registerDialogTree(ctx, makeClient());
        const doc = { languageId: "plaintext", fileName: "CUTSCENE.TSSL" } as import("vscode").TextDocument;
        expect(controller.matchesDocument(doc)).toBe(true);
    });
});
