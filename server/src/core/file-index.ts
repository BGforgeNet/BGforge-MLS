/**
 * Coordinator for Symbols and ReferencesIndex stores.
 *
 * Ensures both stores are updated in lockstep from a single ParseResult,
 * preventing inconsistencies where one store is updated but the other is not.
 */

import type { Location } from "vscode-languageserver/node";
import type { NormalizedUri } from "./normalized-uri";
import type { IndexedSymbol } from "./symbol";
import type { ParseResult } from "./parse-result";
import { Symbols } from "./symbol-index";
import { ReferencesIndex } from "../shared/references-index";
import { nameCaseFor } from "../../../shared/name-case";

/**
 * Wraps Symbols + ReferencesIndex with a single update/remove API.
 * Stores are exposed as readonly for query access by provider features.
 */
export class FileIndex {
    readonly symbols: Symbols;
    readonly refs: ReferencesIndex;

    /**
     * @param languageId Language whose symbols this index holds. It decides how identifiers compare - SSL
     * binds them case-insensitively where D labels and tp2 variables do not (see `shared/name-case.ts`).
     */
    constructor(languageId: string) {
        const nameCase = nameCaseFor(languageId);
        this.symbols = new Symbols({ nameCase });
        this.refs = new ReferencesIndex({ nameCase });
    }

    /** Update both stores from a unified parse result. */
    updateFile(uri: NormalizedUri, result: ParseResult): void {
        this.symbols.updateFile(uri, result.symbols);
        this.refs.updateFile(uri, result.refs);
    }

    /**
     * Reference locations for `name`, under the case rule its DEFINITION declares rather than the language
     * default. A symbol that opted out of the fold (an SSL `#define`, which the preprocessor matches
     * case-sensitively) is looked up exactly, so a differently-spelled name elsewhere is not reported as a
     * reference to it. Both stores are consulted here so no caller has to pair them itself.
     */
    refsOf(name: string): readonly Location[] {
        return this.refs.lookup(name, this.symbols.nameCaseOf(name));
    }

    /** Remove a file from both stores. */
    removeFile(uri: NormalizedUri): void {
        this.symbols.clearFile(uri);
        this.refs.removeFile(uri);
    }

    /** Load static (built-in) symbols into the symbol store. */
    loadStatic(symbols: readonly IndexedSymbol[]): void {
        this.symbols.loadStatic(symbols);
    }
}
