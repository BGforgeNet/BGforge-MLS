import type { BinaryFormatAdapter } from "../format-adapter";
import {
    buildCanonicalProJsonSnapshot,
    createCanonicalProJsonSnapshot,
    loadCanonicalProJsonSnapshot,
} from "./json-snapshot";
import { rebuildProCanonicalDocument } from "./canonical";
import { proLayout } from "./layout-schema";
import { proCompiledPatternFields, proDomainRanges, proPresentationSchema } from "./presentation-schema";
import { slugify } from "../spec/presentation";
import type { ParseOptions, ParseResult } from "../types";

// No retype support: a PRO object-type or subtype change rewrites the whole record, so it is a destructive
// edit the editor does not offer - objectType and subType are readOnlyFields (see layout-schema.ts).
export const proFormatAdapter: BinaryFormatAdapter = {
    formatId: "pro",
    presentationSchema: proPresentationSchema,
    compiledPatternFields: proCompiledPatternFields,
    domainRanges: proDomainRanges,
    // PRO caches a rebuildable canonical document (own writable property); clear it on edit.
    documentCacheStrategy: "clear",
    // Declarative single-page layout covering every PRO object/sub type (see layout-schema.ts).
    layout: proLayout,

    buildJsonSnapshot(parseResult: ParseResult): unknown {
        return buildCanonicalProJsonSnapshot(parseResult);
    },

    createJsonSnapshot(parseResult: ParseResult): string {
        return createCanonicalProJsonSnapshot(parseResult);
    },

    loadJsonSnapshot(jsonText: string, parseOptions?: ParseOptions) {
        const result = loadCanonicalProJsonSnapshot(jsonText, parseOptions);
        return { parseResult: result.parseResult, bytes: result.bytes };
    },

    rebuildCanonicalDocument(parseResult: ParseResult) {
        return rebuildProCanonicalDocument(parseResult);
    },

    toSemanticFieldKey(segments: readonly string[]): string | undefined {
        if (segments.length === 0) {
            return "pro";
        }
        return `pro.${segments.map((segment) => slugify(segment)).join(".")}`;
    },
};

// Registration lives in the root `../format-adapter.ts`: it eagerly imports and
// registers every per-format adapter (this one included) on its own module load.
// This module only exports `proFormatAdapter` and performs no side-effect
// registration itself.
