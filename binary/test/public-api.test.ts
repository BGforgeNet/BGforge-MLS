/**
 * Pins the public surface of @bgforge/binary against the symbols its actual consumers import: the
 * `@bgforge/binary-editor` package (the editor session, structure-op/spellbook-op handling, and the
 * declarative layout resolver), the VS Code binary custom editor in `client/src/binary-editor` (via
 * `binary-editor`'s worker bundle), and the `fgbin` CLI (`binary/src/cli.ts`, imported through this
 * same `./index` barrel). Adding a new public symbol requires extending this list; removing one fails
 * this test before downstream callers see the break.
 */

import { describe, it, expect } from "vitest";
import * as binary from "@bgforge/binary";

const REQUIRED_VALUE_EXPORTS = [
    // Registry + side-effect parsers
    "parserRegistry",
    // JSON snapshot helpers
    "createBinaryJsonSnapshot",
    "parseBinaryJsonSnapshot",
    "loadBinaryJsonSnapshot",
    "getSnapshotPath",
    "getOutputPathForJsonSnapshot",
    // Format adapters
    "formatAdapterRegistry",
    // Presentation
    "createFieldKey",
    "toSemanticFieldKey",
    "createSemanticFieldKeyFromId",
    "resolveFieldPresentation",
    // Display lookups
    "resolveDisplayValue",
    "resolveEnumLookup",
    "resolveFlagLookup",
    "formatEnumDisplayValue",
    "resolveRawValueFromDisplay",
    "resolveStoredFieldValue",
    // Numeric contracts
    "validateNumericValue",
    "getNumericTypeRange",
    "getDomainRange",
    // Flags
    "isFlagActive",
    // Concrete parsers
    "proParser",
    "mapParser",
] as const;

describe("@bgforge/binary public API", () => {
    for (const name of REQUIRED_VALUE_EXPORTS) {
        it(`exports ${name}`, () => {
            expect((binary as Record<string, unknown>)[name]).toBeDefined();
        });
    }

    it("registers the pro parser by extension", () => {
        const proParser = binary.parserRegistry.getByExtension(".pro");
        expect(proParser?.id).toBe("pro");
    });

    it("registers the map parser by extension", () => {
        const mapParser = binary.parserRegistry.getByExtension(".map");
        expect(mapParser?.id).toBe("map");
    });
});
