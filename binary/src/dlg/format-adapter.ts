import type { BinaryFormatAdapter } from "../format-adapter";
import type { ParseResult } from "../types";
import { slugify } from "../spec/presentation";
import {
    buildCanonicalDlgJsonSnapshot,
    createCanonicalDlgJsonSnapshot,
    loadCanonicalDlgJsonSnapshot,
} from "./json-snapshot";

/**
 * DLG carries no presentation schema, layout, or domain ranges by decision: it renders in the dialog
 * editor's graph, not the binary editor's form, so a presentation stack here would be code nothing draws.
 * The interface makes all three optional for exactly this case.
 */
export const dlgFormatAdapter: BinaryFormatAdapter = {
    formatId: "dlg",

    // The canonical document is authoritative for DLG - the graph editor mutates it directly rather than
    // editing a display tree - so it must not be cleared on edit.
    documentCacheStrategy: "none",

    buildJsonSnapshot(parseResult: ParseResult): unknown {
        return buildCanonicalDlgJsonSnapshot(parseResult);
    },

    createJsonSnapshot(parseResult: ParseResult): string {
        return createCanonicalDlgJsonSnapshot(parseResult);
    },

    loadJsonSnapshot(jsonText: string) {
        return loadCanonicalDlgJsonSnapshot(jsonText);
    },

    rebuildCanonicalDocument(parseResult: ParseResult) {
        // `documentCacheStrategy: "none"` means the document is never cleared, so there is nothing to
        // rebuild from the display tree.
        return parseResult.document;
    },

    toSemanticFieldKey(segments: readonly string[]): string | undefined {
        if (segments.length === 0) return undefined;
        return `dlg.${segments.map((s) => slugify(s)).join(".")}`;
    },
};
