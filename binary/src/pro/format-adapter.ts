import type { BinaryFormatAdapter } from "../format-adapter";
import {
    buildCanonicalProJsonSnapshot,
    createCanonicalProJsonSnapshot,
    loadCanonicalProJsonSnapshot,
} from "./json-snapshot";
import { rebuildProCanonicalDocument } from "./canonical";
import { proLayout } from "./layout-schema";
import { proCompiledPatternFields, proDomainRanges, proPresentationSchema } from "./presentation-schema";
import { isProStructuralFieldId, buildProStructuralTransitionBytes } from "./transition";
import { slugify } from "../spec/presentation";
import type { ParseOptions, ParseResult } from "../types";

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

    // Structural-transition capability: implemented but intentionally dormant. A PRO object-type/subtype
    // change rewrites the entire record (each type has its own subtype specs), so it is a destructive
    // whole-record retype the editor deliberately does not offer - objectType/subType are readOnlyFields
    // (see layout-schema.ts), and editField never consults isStructuralFieldId. These methods are the
    // scaffolding for a future explicit "retype" affordance; until one is wired, they never fire. Kept
    // rather than removed so that affordance would not have to re-derive the transition logic.
    isStructuralFieldId(fieldId: string): boolean {
        return isProStructuralFieldId(fieldId);
    },

    buildStructuralTransitionBytes(parseResult: ParseResult, fieldId: string, rawValue: number) {
        return buildProStructuralTransitionBytes(parseResult, fieldId, rawValue);
    },
};

// Registration lives in the root `../format-adapter.ts`: it eagerly imports and
// registers every per-format adapter (this one included) on its own module load.
// This module only exports `proFormatAdapter` and performs no side-effect
// registration itself.
