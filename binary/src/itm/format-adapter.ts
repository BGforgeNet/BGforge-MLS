import type { BinaryFormatAdapter } from "../format-adapter";
import type { ParseOptions, ParseResult } from "../types";
import { rebuildItmCanonicalDocument } from "./canonical";
import { createCanonicalItmJsonSnapshot, loadCanonicalItmJsonSnapshot } from "./json-snapshot";
import { itmCompiledPatternFields, itmDomainRanges, itmPresentationSchema } from "./presentation-schema";
import { abilityEffectsSemanticFieldKey } from "../ie-common/semantic-keys";

export const itmFormatAdapter: BinaryFormatAdapter = {
    formatId: "itm",
    presentationSchema: itmPresentationSchema,
    compiledPatternFields: itmCompiledPatternFields,
    domainRanges: itmDomainRanges,

    createJsonSnapshot(parseResult: ParseResult): string {
        return createCanonicalItmJsonSnapshot(parseResult);
    },

    loadJsonSnapshot(jsonText: string, parseOptions?: ParseOptions) {
        const result = loadCanonicalItmJsonSnapshot(jsonText, parseOptions);
        return { parseResult: result.parseResult, bytes: result.bytes };
    },

    rebuildCanonicalDocument(parseResult: ParseResult) {
        return rebuildItmCanonicalDocument(parseResult);
    },

    toSemanticFieldKey(segments: readonly string[]): string | undefined {
        return abilityEffectsSemanticFieldKey("itm", "ITM Header", segments);
    },
};
