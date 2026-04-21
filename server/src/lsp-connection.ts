/**
 * LSP connection holder.
 * Provides access to the language server connection and documents manager.
 * Populated by server.ts during initialization to avoid circular imports.
 */

import { TextDocument } from "vscode-languageserver-textdocument";
import type { Connection } from "vscode-languageserver/node";
import { TextDocuments } from "vscode-languageserver/node";

let connection: Connection | undefined;
let documents: TextDocuments<TextDocument> | undefined;

/** Initialize the connection holder. Called once during server startup. */
export function initLspConnection(conn: Connection, docs: TextDocuments<TextDocument>): void {
    connection = conn;
    documents = docs;
}

/** Get the LSP connection. Throws if not initialized. */
export function getConnection(): Connection {
    if (!connection) {
        throw new Error("LSP connection not initialized. Call initLspConnection first.");
    }
    return connection;
}

/** Get the documents manager. Throws if not initialized. */
export function getDocuments(): TextDocuments<TextDocument> {
    if (!documents) {
        throw new Error("Documents manager not initialized. Call initLspConnection first.");
    }
    return documents;
}
