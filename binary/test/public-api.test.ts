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
import type {
    BifArchive,
    BifFileEntry,
    BifTilesetEntry,
    ByteSource,
    ExternalRef,
    Game,
    GameIdentity,
    GameResourceRef,
    IeFlavour,
    IeScriptStyle,
    IeVariant,
    KeyBifEntry,
    KeyIndex,
    KeyResource,
    OpenGameOptions,
    Tlk,
    TlkOptions,
} from "@bgforge/binary";

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
    // KEY/BIF archive support
    "parseKey",
    "openBif",
    "parseBif",
    "openTlk",
    "parseTlk",
    "openGame",
    "engineOverrideFolders",
    "detectGameIdentity",
    "bufferSource",
    "fileSource",
    "resourceTypeExt",
    "resourceTypeCode",
] as const;

/**
 * The public TYPE surface, pinned by naming each type in a signature.
 *
 * Enforced by `tsc --noEmit` (the typecheck gate), not by the assertion below: vitest strips types, so a type
 * dropped from the barrel fails this file's COMPILE, never its run. That gap is why a public type could go
 * unexported while every value export stayed pinned - `GameIdentity.flavour` and `ExternalRef["byFlavour"]`
 * both named `IeFlavour`, and `openTlk` took a `TlkOptions`, none of which a consumer could name.
 *
 * Never called; the arity assertion keeps the count honest so a name cannot be quietly dropped along with its
 * parameter. Extend it alongside REQUIRED_VALUE_EXPORTS when a public type is added.
 */
function pinPublicTypes(
    key: KeyIndex,
    keyBif: KeyBifEntry,
    keyResource: KeyResource,
    bif: BifArchive,
    bifFile: BifFileEntry,
    bifTileset: BifTilesetEntry,
    tlk: Tlk,
    tlkOptions: TlkOptions,
    byteSource: ByteSource,
    game: Game,
    gameResource: GameResourceRef,
    gameOptions: OpenGameOptions,
    identity: GameIdentity,
    variant: IeVariant,
    scriptStyle: IeScriptStyle,
    flavour: IeFlavour,
    ref: ExternalRef,
): number {
    return [
        key,
        keyBif,
        keyResource,
        bif,
        bifFile,
        bifTileset,
        tlk,
        tlkOptions,
        byteSource,
        game,
        gameResource,
        gameOptions,
        identity,
        variant,
        scriptStyle,
        flavour,
        ref,
    ].length;
}

describe("@bgforge/binary public API", () => {
    it("exports every public type by name", () => {
        expect(pinPublicTypes).toHaveLength(17);
    });

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
