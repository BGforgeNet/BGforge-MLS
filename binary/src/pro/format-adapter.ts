import type { BinaryFormatAdapter } from "../format-adapter";
import { createCanonicalProJsonSnapshot, loadCanonicalProJsonSnapshot } from "./json-snapshot";
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
    // Declarative single-page layout. Only the "critter" variant is authored so far; other PRO
    // object/sub types report a variantId with no matching variant and fall back to the tabs path.
    layout: proLayout,

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

// Self-register on module load. Public `binary/src/index.ts` triggers this
// by side-effect-importing the per-format adapter modules in its bottom
// block; format-adapter.ts itself has no bottom-imports, so domain-range and
// presentation-schema can read the registry without dragging in canonical
// readers (which transitively depend on domain-range).
