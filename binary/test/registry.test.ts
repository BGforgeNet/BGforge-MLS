import { describe, expect, it } from "vitest";
import { parserRegistry } from "../src/registry";
import { formatAdapterRegistry, type BinaryFormatAdapter } from "../src/format-adapter";
import type { BinaryParser } from "../src/types";

function makeParser(id: string, extensions: string[], family: BinaryParser["family"] = "fallout"): BinaryParser {
    return {
        id,
        name: id,
        extensions,
        family,
        parse: () => ({ fields: [] }) as unknown as ReturnType<BinaryParser["parse"]>,
    };
}

function makeAdapter(formatId: string): BinaryFormatAdapter {
    return {
        formatId,
        documentCacheStrategy: "none",
        buildJsonSnapshot: () => ({}),
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

    /**
     * The two game families collide on `.pro` (a Fallout PROTOTYPE, an Infinity Engine PROJECTILE), so an
     * extension shared across families must keep BOTH parsers - the pre-family registry overwrote one, which is
     * what made "does anything read this extension?" answer about the wrong game.
     */
    it("keeps a parser per family on a shared extension, and returns the one asked for", () => {
        const fallout = makeParser("registry-test-fallout", ["rtx"], "fallout");
        const ie = makeParser("registry-test-ie", ["rtx"], "infinity-engine");
        parserRegistry.register(fallout);
        parserRegistry.register(ie);

        expect(parserRegistry.getByExtension("rtx", "fallout")).toBe(fallout);
        expect(parserRegistry.getByExtension(".rtx", "infinity-engine")).toBe(ie);
        // A caller holding only a file path cannot supply a family, so the lookup stays answerable - it just
        // means "some parser claims this", and on a shared extension it is the first registered.
        expect(parserRegistry.getByExtension("rtx")).toBe(fallout);
    });

    // A miss, not a fallback to the other family's parser - which is the whole point: real `.pro` must not
    // resolve to the Fallout reader for a caller holding an Infinity Engine projectile.
    it("does not answer with a parser from another family", () => {
        const fallout = makeParser("registry-test-single-family", ["rty"], "fallout");
        parserRegistry.register(fallout);

        expect(parserRegistry.getByExtension("rty", "fallout")).toBe(fallout);
        expect(parserRegistry.getByExtension("rty", "infinity-engine")).toBeUndefined();
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
