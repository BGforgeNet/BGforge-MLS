import type { BinaryFormatAdapter } from "../format-adapter";
import type { ParseOptions, ParseResult } from "../types";
import { rebuildItmCanonicalDocument } from "./canonical";
import { createCanonicalItmJsonSnapshot, loadCanonicalItmJsonSnapshot } from "./json-snapshot";
import { slugify } from "../snapshot-common";

function itmSemanticFieldKey(segments: readonly string[]): string | undefined {
    if (segments.length === 0) return undefined;
    const [first, second, third] = segments;

    if (first === "ITM Header") {
        return `itm.header.${slugify(second ?? "")}`;
    }
    if (first === "Abilities") {
        // second is "Ability N", third is the field display label
        if (third) {
            return `itm.abilities[].${slugify(third)}`;
        }
        return "itm.abilities[]";
    }
    if (first === "Effects") {
        if (third) {
            return `itm.effects[].${slugify(third)}`;
        }
        return "itm.effects[]";
    }
    return `itm.${segments.map((s) => slugify(s)).join(".")}`;
}

export const itmFormatAdapter: BinaryFormatAdapter = {
    formatId: "itm",

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
        return itmSemanticFieldKey(segments);
    },
};
