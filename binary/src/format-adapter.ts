/**
 * BinaryFormatAdapter: per-format extension point for snapshot, presentation,
 * editor projection, and structural edit behaviour.
 *
 * Adapters are registered alongside parsers and eliminate format-specific
 * branching in the snapshot, presentation, editor, and validation layers.
 */

import type { ParsedField, ParsedGroup, ParseOptions, ParseResult } from "./types";

export type ProjectedEntry =
    | { readonly kind: "field"; readonly entry: ParsedField; readonly sourceSegments: readonly string[] }
    | {
          readonly kind: "group";
          readonly entry: ParsedGroup;
          readonly sourceSegments: readonly string[];
          readonly children: readonly ProjectedEntry[];
      };

export interface BinaryFormatAdapter {
    readonly formatId: string;

    // -- Snapshots -------------------------------------------------------------
    createJsonSnapshot(parseResult: ParseResult): string;
    loadJsonSnapshot(jsonText: string, parseOptions?: ParseOptions): { parseResult: ParseResult; bytes?: Uint8Array };

    // -- Canonical document rebuild --------------------------------------------
    rebuildCanonicalDocument(parseResult: ParseResult): unknown | undefined;

    // -- Presentation ----------------------------------------------------------
    toSemanticFieldKey(segments: readonly string[]): string | undefined;

    // -- Editor projection (optional) ------------------------------------------
    shouldHideField?(entry: ParsedField): boolean;
    shouldHideGroup?(entry: ParsedGroup): boolean;
    projectDisplayRoot?(
        parseResult: ParseResult,
        projectEntry: (
            parseResult: ParseResult,
            entry: ParsedField | ParsedGroup,
            sourceSegments: readonly string[],
        ) => ProjectedEntry | undefined,
    ): ProjectedEntry[];

    // -- Structural edits (optional) -------------------------------------------
    isStructuralFieldId?(fieldId: string): boolean;
    buildStructuralTransitionBytes?(
        parseResult: ParseResult,
        fieldId: string,
        rawValue: number,
    ): Uint8Array | undefined;

    // -- Add/remove entries in variable-length arrays (optional) ---------------
    /**
     * Produce the bytes for `parseResult` with one new default entry appended
     * to the array at `arrayPath` (tree-segment names, e.g. `["Global Variables"]`).
     * Returns `undefined` if the path is not a known addable array for this
     * format.
     */
    buildAddEntryBytes?(parseResult: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined;
    /**
     * Produce the bytes for `parseResult` with the entry at `entryPath` removed
     * from its array (tree-segment names, e.g. `["Global Variables", "Global Var 3"]`).
     * Returns `undefined` if the path is not a known removable entry for this
     * format.
     */
    buildRemoveEntryBytes?(parseResult: ParseResult, entryPath: readonly string[]): Uint8Array | undefined;
}

class FormatAdapterRegistry {
    private readonly adapters = new Map<string, BinaryFormatAdapter>();

    register(adapter: BinaryFormatAdapter): void {
        if (this.adapters.has(adapter.formatId)) {
            console.warn(`Format adapter "${adapter.formatId}" already registered, overwriting`);
        }
        this.adapters.set(adapter.formatId, adapter);
    }

    get(formatId: string): BinaryFormatAdapter | undefined {
        return this.adapters.get(formatId);
    }
}

export const formatAdapterRegistry = new FormatAdapterRegistry();

// Eagerly register all built-in format adapters.
// Safe from circular dependencies: neither adapter file imports format-adapter.ts.
import { proFormatAdapter } from "./pro/format-adapter";
import { mapFormatAdapter } from "./map/format-adapter";

formatAdapterRegistry.register(proFormatAdapter);
formatAdapterRegistry.register(mapFormatAdapter);
