/**
 * Cross-file references index for workspace-wide Find References.
 *
 * Maps symbolName -> uri -> Location[] across all indexed files.
 * Populated at startup during workspace scan, updated incrementally
 * via reloadFileData when files change.
 */

import type { Location } from "vscode-languageserver/node";
import type { NormalizedUri } from "../core/normalized-uri";

/**
 * Index of cross-file references for workspace-wide Find References.
 * Stores reference locations per file, keyed by symbol name.
 *
 * URI keys use the NormalizedUri branded type to enforce consistent encoding.
 * All callers go through ProviderRegistry gateway which normalizes URIs.
 */
export class ReferencesIndex {
    /** uri -> (symbolName -> Location[]) */
    private readonly files: Map<NormalizedUri, ReadonlyMap<string, readonly Location[]>> = new Map();

    /**
     * Replace all references for a file.
     * @param uri Normalized file URI (guaranteed by ProviderRegistry gateway)
     * @param refs Map of symbolName -> Location[] extracted from the file
     */
    updateFile(uri: NormalizedUri, refs: ReadonlyMap<string, readonly Location[]>): void {
        this.files.set(uri, refs);
    }

    /**
     * Remove all references for a file.
     */
    removeFile(uri: NormalizedUri): void {
        this.files.delete(uri);
    }

    /**
     * Look up URIs of all files that reference a symbol name.
     * More efficient than lookup() when only file membership is needed (e.g., rename).
     */
    lookupUris(symbolName: string): ReadonlySet<string> {
        const uris = new Set<string>();
        for (const [uri, fileRefs] of this.files) {
            if (fileRefs.has(symbolName)) {
                uris.add(uri);
            }
        }
        return uris;
    }

    /**
     * Look up all cross-file locations for a symbol name.
     * Returns locations from ALL indexed files.
     */
    lookup(symbolName: string): readonly Location[] {
        const results: Location[] = [];
        for (const fileRefs of this.files.values()) {
            const locs = fileRefs.get(symbolName);
            if (locs) {
                for (const loc of locs) {
                    results.push(loc);
                }
            }
        }
        return results;
    }
}
