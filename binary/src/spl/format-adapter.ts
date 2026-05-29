import type { BinaryFormatAdapter } from "../format-adapter";
import type { ParseOptions, ParseResult } from "../types";
import { rebuildSplCanonicalDocument } from "./canonical";
import { createCanonicalSplJsonSnapshot, loadCanonicalSplJsonSnapshot } from "./json-snapshot";
import { splCompiledPatternFields, splDomainRanges, splPresentationSchema } from "./presentation-schema";
import { abilityEffectsSemanticFieldKey } from "../ie-common/semantic-keys";

export const splFormatAdapter: BinaryFormatAdapter = {
    formatId: "spl",
    presentationSchema: splPresentationSchema,
    compiledPatternFields: splCompiledPatternFields,
    domainRanges: splDomainRanges,

    createJsonSnapshot(parseResult: ParseResult): string {
        return createCanonicalSplJsonSnapshot(parseResult);
    },

    loadJsonSnapshot(jsonText: string, parseOptions?: ParseOptions) {
        const result = loadCanonicalSplJsonSnapshot(jsonText, parseOptions);
        return { parseResult: result.parseResult, bytes: result.bytes };
    },

    rebuildCanonicalDocument(parseResult: ParseResult) {
        return rebuildSplCanonicalDocument(parseResult);
    },

    toSemanticFieldKey(segments: readonly string[]): string | undefined {
        return abilityEffectsSemanticFieldKey("spl", "SPL Header", segments);
    },
};
