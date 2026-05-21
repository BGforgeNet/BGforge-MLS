import type { BinaryFormatAdapter } from "../format-adapter";
import type { ParseOptions, ParseResult } from "../types";
import { rebuildCreCanonicalDocument } from "./canonical";
import { createCanonicalCreJsonSnapshot, loadCanonicalCreJsonSnapshot } from "./json-snapshot";
import { creCompiledPatternFields, crePresentationSchema } from "./presentation-schema";
import { slugify } from "../snapshot-common";
import { CRE_GROUP_LABELS } from "./types";

/**
 * Maps a top-level display-group label to the semantic-key namespace plus
 * the segment index that carries the field name. Header / Item Slots are
 * struct-shaped (field name at depth 1), the rest are array-of-records
 * (field name at depth 2 because the entry name "Item N" sits between).
 *
 * Effects: EFF v1 and v2 records share a generic per-entry group label
 * ("Effect N") with different field shapes underneath. The router projects
 * both into the v2 namespace; resolveFieldPresentation falls through to v1
 * if no v2 exact match exists for the slug.
 */
type GroupRoute = { readonly prefix: string; readonly fieldSegment: 1 | 2 };
const GROUP_ROUTES: Readonly<Record<string, GroupRoute>> = {
    [CRE_GROUP_LABELS.header]: { prefix: "cre.header", fieldSegment: 1 },
    [CRE_GROUP_LABELS.knownSpells]: { prefix: "cre.knownSpells[]", fieldSegment: 2 },
    [CRE_GROUP_LABELS.spellMemInfo]: { prefix: "cre.spellMemInfo[]", fieldSegment: 2 },
    [CRE_GROUP_LABELS.memorizedSpells]: { prefix: "cre.memorizedSpells[]", fieldSegment: 2 },
    [CRE_GROUP_LABELS.effects]: { prefix: "cre.effects[].v2", fieldSegment: 2 },
    [CRE_GROUP_LABELS.items]: { prefix: "cre.items[]", fieldSegment: 2 },
    [CRE_GROUP_LABELS.itemSlots]: { prefix: "cre.itemSlots", fieldSegment: 1 },
};

function creSemanticFieldKey(segments: readonly string[]): string | undefined {
    if (segments.length === 0) return undefined;
    const route = GROUP_ROUTES[segments[0]!];
    if (route) {
        const fieldName = segments[route.fieldSegment];
        return fieldName ? `${route.prefix}.${slugify(fieldName)}` : route.prefix;
    }
    // Fall-through for nested walkStruct sub-groups (e.g. future packed-field
    // sub-groups). Slugified path keeps presentation lookup routable.
    if (segments.length > 1) return `cre.${segments.map((s) => slugify(s)).join(".")}`;
    return undefined;
}

export const creFormatAdapter: BinaryFormatAdapter = {
    formatId: "cre",
    presentationSchema: crePresentationSchema,
    compiledPatternFields: creCompiledPatternFields,

    createJsonSnapshot(parseResult: ParseResult): string {
        return createCanonicalCreJsonSnapshot(parseResult);
    },

    loadJsonSnapshot(jsonText: string, parseOptions?: ParseOptions) {
        const result = loadCanonicalCreJsonSnapshot(jsonText, parseOptions);
        return { parseResult: result.parseResult, bytes: result.bytes };
    },

    rebuildCanonicalDocument(parseResult: ParseResult) {
        return rebuildCreCanonicalDocument(parseResult);
    },

    toSemanticFieldKey(segments: readonly string[]): string | undefined {
        return creSemanticFieldKey(segments);
    },
};
