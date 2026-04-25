import type { BinaryFormatAdapter } from "./format-adapter";
import { createCanonicalProJsonSnapshot, loadCanonicalProJsonSnapshot } from "./pro-json-snapshot";
import { rebuildProCanonicalDocument } from "./pro-canonical";
import { isProStructuralFieldId, buildProStructuralTransitionBytes } from "./pro-transition";
import { slugify } from "./snapshot-common";
import type { ParseOptions, ParseResult } from "./types";

export const proFormatAdapter: BinaryFormatAdapter = {
    formatId: "pro",

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

    isStructuralFieldId(fieldId: string): boolean {
        return isProStructuralFieldId(fieldId);
    },

    buildStructuralTransitionBytes(parseResult: ParseResult, fieldId: string, rawValue: number) {
        return buildProStructuralTransitionBytes(parseResult, fieldId, rawValue);
    },
};
