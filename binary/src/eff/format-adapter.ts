import type { BinaryFormatAdapter } from "../format-adapter";
import type { ParseOptions, ParseResult } from "../types";
import { rebuildEffCanonicalDocument } from "./canonical";
import { createCanonicalEffJsonSnapshot, loadCanonicalEffJsonSnapshot } from "./json-snapshot";
import { effCompiledPatternFields, effPresentationSchema } from "./presentation-schema";
import { slugify } from "../snapshot-common";

function effSemanticFieldKey(segments: readonly string[]): string | undefined {
    if (segments.length === 0) return undefined;
    const [first, second] = segments;

    if (first === "EFF Header") {
        return `eff.header.${slugify(second ?? "")}`;
    }
    if (first === "EFF Body") {
        return `eff.body.${slugify(second ?? "")}`;
    }
    return `eff.${segments.map((s) => slugify(s)).join(".")}`;
}

export const effFormatAdapter: BinaryFormatAdapter = {
    formatId: "eff",
    presentationSchema: effPresentationSchema,
    compiledPatternFields: effCompiledPatternFields,

    createJsonSnapshot(parseResult: ParseResult): string {
        return createCanonicalEffJsonSnapshot(parseResult);
    },

    loadJsonSnapshot(jsonText: string, parseOptions?: ParseOptions) {
        const result = loadCanonicalEffJsonSnapshot(jsonText, parseOptions);
        return { parseResult: result.parseResult, bytes: result.bytes };
    },

    rebuildCanonicalDocument(parseResult: ParseResult) {
        return rebuildEffCanonicalDocument(parseResult);
    },

    toSemanticFieldKey(segments: readonly string[]): string | undefined {
        return effSemanticFieldKey(segments);
    },
};
