// Public API surface of @bgforge/binary.
// Pinned by binary/test/public-api.test.ts.

// Core registry and types
export { parserRegistry } from "./registry";
export type {
    BinaryParser,
    ParseOptions,
    ParseResult,
    ParsedField,
    ParsedFieldType,
    ParsedGroup,
    ParseOpaqueRange,
} from "./types";

// JSON snapshot helpers
export { createBinaryJsonSnapshot, parseBinaryJsonSnapshot, loadBinaryJsonSnapshot } from "./json-snapshot";
export { getSnapshotPath, getOutputPathForJsonSnapshot } from "./json-snapshot-path";

// Format adapters
export { formatAdapterRegistry } from "./format-adapter";
export type { BinaryFormatAdapter, ProjectedEntry } from "./format-adapter";
export type { CrossRefRelationship, IndexRefRelationship, SliceRefRelationship } from "./cross-ref-relationship";

// Declarative layout schema (per-format editor UI as data)
export { formatLayoutSchema, variantRows } from "./layout-schema-types";
// Shared layout fragment: the EFF v2 body, reused by standalone `.eff` and CRE-embedded v2 effects.
export { effV2BodyLabels, effV2BodyRows } from "./eff/effect-body-layout";
// Shared layout fragment: the ITM/SPL feature block (48-byte effect), also the CRE effStructureVersion-0 effect
// (byte-identical record - IESDP documents them as one structure).
export { featureBlockBodyLabels, featureBlockBodyRows } from "./ie-common/feature-block-layout";
// Shared layout fragments: the ITM/SPL ability headers (parallel records, curated panels per format).
export { itmAbilityBodyLabels, itmAbilityBodyRows } from "./itm/ability-layout";
export { splAbilityBodyLabels, splAbilityBodyRows } from "./spl/ability-layout";
// Spellbook editor structural builders: memorize (append to a memorization range) and remove-orphan
// (drop a memorized spell covered by no range).
export { buildCreMemorizeBytes, buildCreRemoveOrphanMemorizedBytes } from "./cre/entity-ops";
export type {
    DetailBlock,
    DetailPanel,
    DetailRow,
    FieldRef,
    FormatLayout,
    LayoutBlock,
    LayoutChildList,
    LayoutPanel,
    LayoutRow,
    LayoutSubTab,
    LayoutTab,
    LayoutVariant,
} from "./layout-schema-types";

// Presentation schema
export {
    createFieldKey,
    toSemanticFieldKey,
    createSemanticFieldKeyFromId,
    resolveFieldPresentation,
    toNumericOptionMap,
} from "./presentation-schema";

// Display lookups
export {
    resolveDisplayValue,
    resolveEnumLookup,
    resolveFlagLookup,
    resolveStringCharset,
    formatEnumDisplayValue,
    resolveRawValueFromDisplay,
    resolveStoredFieldValue,
} from "./display-lookups";

// Numeric contracts
export { validateNumericValue, getNumericTypeRange, getDomainRange } from "./binary-format-contract";
export type { NumericRange } from "./binary-format-contract";

// Flags
export { isFlagActive } from "./flags";

// String field charsets - single source of truth for "what does ascii-printable mean".
export type { StringCharset } from "./string-charset";
export { isCharAllowedInCharset, isStringAllowedInCharset } from "./string-charset";

// Concrete parser implementations
export { proParser } from "./pro";
export { mapParser } from "./map";
export { itmParser } from "./itm";
export { splParser } from "./spl";
export { effParser } from "./eff";
export { creParser } from "./cre";

// Pid -> subType resolution for MAP item / scenery decode. The default
// resolver is backed by a bundled vanilla Fallout 2 lookup table; consumers
// extend coverage by composing custom resolvers - typically a filesystem
// loader pointed at a mod's own `proto/` tree - on top of the default.
export { resolvePidSubType, type PidResolver } from "./pid-resolver";
export {
    loadProDirResolver,
    composePidResolvers,
    type ProResolverResult,
    type ProResolverStats,
} from "./pro-resolver-loader";
export {
    buildFileDerivedParseOptions,
    type FileDerivedParseOptions,
    type FileDerivedDiagnostics,
} from "./parse-options";

// IE opcode relationship data (param labels, enum tables, engine availability)
export { OpcodeRelationships } from "./ie-common/opcode-relationships";
export type { OpcodeRelationship } from "./ie-common/opcode-relationships";

// Infinity Engine KEY/BIF archives: read an installed game's resource namespace (chitin.key + its BIFs).
// Read-only and streamed - a large BIF is never bulk-loaded. Entry point: openGame(dir).
export {
    parseKey,
    openBif,
    parseBif,
    openTlk,
    parseIds,
    parseTlk,
    openGame,
    engineOverrideFolders,
    detectGameIdentity,
    bufferSource,
    fileSource,
    resourceTypeExt,
    resourceTypeCode,
} from "./archive";
export type {
    KeyIndex,
    KeyBifEntry,
    KeyResource,
    BifArchive,
    BifFileEntry,
    BifTilesetEntry,
    Tlk,
    ByteSource,
    Game,
    GameResourceRef,
    OpenGameOptions,
    GameIdentity,
    IeVariant,
    IeScriptStyle,
} from "./archive";

// Side-effect: register the bundled parsers on the registry.
import { proParser } from "./pro";
import { mapParser } from "./map";
import { itmParser } from "./itm";
import { splParser } from "./spl";
import { effParser } from "./eff";
import { creParser } from "./cre";
import { parserRegistry } from "./registry";
parserRegistry.register(proParser);
parserRegistry.register(mapParser);
parserRegistry.register(itmParser);
parserRegistry.register(splParser);
parserRegistry.register(effParser);
parserRegistry.register(creParser);
