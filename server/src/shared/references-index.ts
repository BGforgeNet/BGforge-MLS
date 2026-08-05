/**
 * Cross-file references index for workspace-wide Find References.
 *
 * Maps symbolName -> uri -> Location[] across all indexed files.
 * Populated at startup during workspace scan, updated incrementally
 * via reloadFileData when files change.
 */

import type { Location } from "vscode-languageserver/node";
import type { NormalizedUri } from "../core/normalized-uri";
import { type NameCase, nameCaseKey } from "../../../shared/name-case";

/** One file's references: locations under the spelling the source used, plus the fold grouping when needed. */
interface FileRefs {
    readonly byName: ReadonlyMap<string, readonly Location[]>;
    /** Folded key -> the spellings this file uses. Built only for a folding index. */
    readonly spellings: ReadonlyMap<string, readonly string[]> | undefined;
}

/** Shared empty result, so a miss allocates nothing on the per-file loops above. */
const EMPTY: readonly string[] = [];

/** Constructor options for ReferencesIndex. */
interface ReferencesIndexOptions {
    /**
     * How this instance compares identifiers. Defaults to `"exact"`; a language whose identifiers bind
     * case-insensitively passes `"fold"` (see `shared/name-case.ts`).
     */
    nameCase?: NameCase;
}

/**
 * Index of cross-file references for workspace-wide Find References.
 * Stores reference locations per file, keyed by symbol name.
 *
 * URI keys use the NormalizedUri branded type to enforce consistent encoding.
 * All callers go through ProviderRegistry gateway which normalizes URIs.
 */
export class ReferencesIndex {
    /** uri -> that file's references */
    private readonly files: Map<NormalizedUri, FileRefs> = new Map();

    /** How this instance compares identifiers unless a query overrides it. */
    private readonly nameCase: NameCase;

    constructor(options?: ReferencesIndexOptions) {
        this.nameCase = options?.nameCase ?? "exact";
    }

    /**
     * Replace all references for a file.
     * @param uri Normalized file URI (guaranteed by ProviderRegistry gateway)
     * @param refs Map of symbolName -> Location[] extracted from the file
     */
    updateFile(uri: NormalizedUri, refs: ReadonlyMap<string, readonly Location[]>): void {
        this.files.set(uri, {
            byName: refs,
            spellings: this.nameCase === "fold" ? spellingsByKey(refs) : undefined,
        });
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
    lookupUris(symbolName: string, nameCase: NameCase = this.nameCase): ReadonlySet<NormalizedUri> {
        const uris = new Set<NormalizedUri>();
        for (const [uri, fileRefs] of this.files) {
            if (spellingsOf(fileRefs, symbolName, nameCase).length > 0) {
                uris.add(uri);
            }
        }
        return uris;
    }

    /**
     * Look up all cross-file locations for a symbol name.
     * Returns locations from ALL indexed files.
     */
    lookup(symbolName: string, nameCase: NameCase = this.nameCase): readonly Location[] {
        const results: Location[] = [];
        for (const fileRefs of this.files.values()) {
            for (const spelling of spellingsOf(fileRefs, symbolName, nameCase)) {
                const locs = fileRefs.byName.get(spelling);
                if (locs) {
                    for (const loc of locs) {
                        results.push(loc);
                    }
                }
            }
        }
        return results;
    }
}

/**
 * The spellings of `symbolName` this file actually uses. A folded query returns every case spelling the file
 * holds; an exact one returns only that spelling, which is what a caller asking about a name its own
 * preprocessor matches case-sensitively needs (an SSL `#define`).
 */
function spellingsOf(fileRefs: FileRefs, symbolName: string, nameCase: NameCase): readonly string[] {
    if (nameCase === "fold" && fileRefs.spellings) {
        return fileRefs.spellings.get(nameCaseKey(symbolName, "fold")) ?? EMPTY;
    }
    return fileRefs.byName.has(symbolName) ? [symbolName] : EMPTY;
}

/**
 * Group a file's reference names by folded key, so a folded lookup can reach every spelling while the
 * locations stay filed under the spelling the source actually used.
 */
function spellingsByKey(refs: ReadonlyMap<string, readonly Location[]>): ReadonlyMap<string, readonly string[]> {
    const byKey = new Map<string, string[]>();
    for (const name of refs.keys()) {
        const key = nameCaseKey(name, "fold");
        const existing = byKey.get(key);
        if (existing) existing.push(name);
        else byKey.set(key, [name]);
    }
    return byKey;
}
