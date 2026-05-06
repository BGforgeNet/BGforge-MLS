import type { BinaryFormatAdapter } from "../format-adapter";
import type { ParseOptions, ParseResult } from "../types";
import { rebuildSplCanonicalDocument } from "./canonical";
import { createCanonicalSplJsonSnapshot, loadCanonicalSplJsonSnapshot } from "./json-snapshot";
import { slugify } from "../snapshot-common";

function splSemanticFieldKey(segments: readonly string[]): string | undefined {
    if (segments.length === 0) return undefined;
    const [first, second, third] = segments;

    if (first === "SPL Header") {
        return `spl.header.${slugify(second ?? "")}`;
    }
    if (first === "Abilities") {
        if (third) {
            return `spl.abilities[].${slugify(third)}`;
        }
        return "spl.abilities[]";
    }
    if (first === "Effects") {
        if (third) {
            return `spl.effects[].${slugify(third)}`;
        }
        return "spl.effects[]";
    }
    return `spl.${segments.map((s) => slugify(s)).join(".")}`;
}

export const splFormatAdapter: BinaryFormatAdapter = {
    formatId: "spl",

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
        return splSemanticFieldKey(segments);
    },
};
