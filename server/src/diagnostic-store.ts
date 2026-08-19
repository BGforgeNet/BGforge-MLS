/**
 * Per-source diagnostic store.
 *
 * LSP `textDocument/publishDiagnostics` is last-write-wins: each
 * `sendDiagnostics(uri, [...])` replaces the file's entire diagnostic set. That
 * is fine when a single producer owns a file, but the extension now publishes
 * from two independent sources for the same file - the external compiler
 * (sslc / weidu) and the tree-sitter parse - and a raw send from either would
 * wipe the other.
 *
 * This store keeps one bucket per (uri, source) and republishes the union on
 * every change, so the two sources coexist regardless of arrival order (the
 * tree-sitter pass is synchronous; the compiler result arrives later, async).
 */

import type { Diagnostic } from "vscode-languageserver/node";
import { type NormalizedUri, normalizeUri } from "./core/normalized-uri";
import { getConnection } from "./lsp-connection";

/** Identifies which producer owns a diagnostic bucket for a URI. */
export type DiagnosticSource = "compiler" | "tree-sitter" | "translation";

// Keyed by NormalizedUri (not raw string): the compiler and tree-sitter producers
// can pass differently-encoded URIs for the same file (Windows `%3A` vs `:`), and a
// raw-string key would split their buckets and reintroduce the clobbering this store
// prevents. A URI with no entry has no diagnostics.
const store = new Map<NormalizedUri, Map<DiagnosticSource, Diagnostic[]>>();

/** Republish the union of all source buckets for a URI as the file's diagnostics. */
function publish(uri: NormalizedUri): void {
    const bySource = store.get(uri);
    const merged: Diagnostic[] = [];
    if (bySource) {
        for (const diags of bySource.values()) {
            merged.push(...diags);
        }
    }
    void getConnection().sendDiagnostics({ uri, diagnostics: merged });
}

/**
 * Replace one source's diagnostics for a URI and republish the merged set.
 * An empty array clears just that source (its bucket is dropped), leaving any
 * other source's diagnostics on the file intact.
 */
export function setDiagnostics(rawUri: string, source: DiagnosticSource, diagnostics: Diagnostic[]): void {
    const uri = normalizeUri(rawUri);
    let bySource = store.get(uri);
    if (diagnostics.length === 0) {
        if (bySource) {
            bySource.delete(source);
            if (bySource.size === 0) {
                store.delete(uri);
            }
        }
    } else {
        if (!bySource) {
            bySource = new Map();
            store.set(uri, bySource);
        }
        bySource.set(source, diagnostics);
    }
    publish(uri);
}

/**
 * What one source currently holds for a URI, empty when it holds nothing.
 *
 * Read back rather than remembered by the producer because a compile's diagnostics are assembled across
 * several calls before anything can act on the whole set.
 */
export function getDiagnostics(rawUri: string, source: DiagnosticSource): readonly Diagnostic[] {
    return store.get(normalizeUri(rawUri))?.get(source) ?? [];
}

/** Clear the compiler source's diagnostics for a URI (tree-sitter bucket untouched). */
export function clearCompilerDiagnostics(uri: string): void {
    setDiagnostics(uri, "compiler", []);
}

/** Drop every source's diagnostics for a URI and publish an empty set. */
export function clearAllDiagnostics(rawUri: string): void {
    const uri = normalizeUri(rawUri);
    store.delete(uri);
    void getConnection().sendDiagnostics({ uri, diagnostics: [] });
}
