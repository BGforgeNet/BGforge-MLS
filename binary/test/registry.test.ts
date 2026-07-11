import { describe, expect, it } from "vitest";
import { parserRegistry } from "../src/registry";
import { formatAdapterRegistry, type BinaryFormatAdapter } from "../src/format-adapter";
import type { BinaryParser } from "../src/types";

function makeParser(id: string, extensions: string[]): BinaryParser {
    return {
        id,
        name: id,
        extensions,
        parse: () => ({ fields: [] }) as unknown as ReturnType<BinaryParser["parse"]>,
    };
}

function makeAdapter(formatId: string): BinaryFormatAdapter {
    return {
        formatId,
        documentCacheStrategy: "none",
        createJsonSnapshot: () => "",
        loadJsonSnapshot: () =>
            ({ parseResult: { fields: [] } }) as unknown as ReturnType<BinaryFormatAdapter["loadJsonSnapshot"]>,
        rebuildCanonicalDocument: () => undefined,
        toSemanticFieldKey: () => undefined,
    };
}

describe("parserRegistry", () => {
    it("throws when registering a second parser under an already-used id", () => {
        parserRegistry.register(makeParser("registry-test-dup", ["rtd1"]));
        expect(() => parserRegistry.register(makeParser("registry-test-dup", ["rtd2"]))).toThrow(/"registry-test-dup"/);
    });
});

describe("formatAdapterRegistry", () => {
    it("throws when registering a second adapter under an already-used formatId", () => {
        formatAdapterRegistry.register(makeAdapter("format-adapter-test-dup"));
        expect(() => formatAdapterRegistry.register(makeAdapter("format-adapter-test-dup"))).toThrow(
            /"format-adapter-test-dup"/,
        );
    });
});
