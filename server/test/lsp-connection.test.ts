/**
 * Tests for lsp-connection.ts — init/getter pattern for the LSP connection holder.
 *
 * The module uses module-level mutable state. To isolate tests from each other
 * the module is reset via vi.resetModules() and re-imported before each test.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Connection, TextDocuments } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";

describe("lsp-connection", () => {
    // Re-import the module in each test so the module-level `connection` and
    // `documents` variables are reset to undefined.
    let initLspConnection: (conn: Connection, docs: TextDocuments<TextDocument>) => void;
    let getConnection: () => Connection;
    let getDocuments: () => TextDocuments<TextDocument>;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import("../src/lsp-connection");
        initLspConnection = mod.initLspConnection;
        getConnection = mod.getConnection;
        getDocuments = mod.getDocuments;
    });

    it("getConnection throws before initLspConnection is called", () => {
        expect(() => getConnection()).toThrow("LSP connection not initialized");
    });

    it("getDocuments throws before initLspConnection is called", () => {
        expect(() => getDocuments()).toThrow("Documents manager not initialized");
    });

    it("initLspConnection stores the connection and getConnection returns it", () => {
        const mockConn = { console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as Connection;
        const mockDocs = {} as unknown as TextDocuments<TextDocument>;

        initLspConnection(mockConn, mockDocs);

        expect(getConnection()).toBe(mockConn);
    });

    it("initLspConnection stores the documents manager and getDocuments returns it", () => {
        const mockConn = { console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as Connection;
        const mockDocs = { get: vi.fn() } as unknown as TextDocuments<TextDocument>;

        initLspConnection(mockConn, mockDocs);

        expect(getDocuments()).toBe(mockDocs);
    });

    it("calling initLspConnection a second time replaces the stored refs", () => {
        const conn1 = { id: 1 } as unknown as Connection;
        const docs1 = { id: 1 } as unknown as TextDocuments<TextDocument>;
        const conn2 = { id: 2 } as unknown as Connection;
        const docs2 = { id: 2 } as unknown as TextDocuments<TextDocument>;

        initLspConnection(conn1, docs1);
        initLspConnection(conn2, docs2);

        expect(getConnection()).toBe(conn2);
        expect(getDocuments()).toBe(docs2);
    });
});
