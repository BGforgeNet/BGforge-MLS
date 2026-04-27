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

// Edit policy
export { findEditableField } from "./field-edit-policy";

// Presentation schema
export {
    createFieldKey,
    toSemanticFieldKey,
    createSemanticFieldKeyFromId,
    resolveFieldPresentation,
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
export { validateNumericValue } from "./binary-format-contract";

// Flags
export { isFlagActive } from "./flags";

// String field charsets — single source of truth for "what does ascii-printable mean".
export type { StringCharset } from "./string-charset";
export { isCharAllowedInCharset, isStringAllowedInCharset } from "./string-charset";

// Concrete parser implementations
export { proParser } from "./pro";
export { mapParser } from "./map";

// Side-effect: register the bundled parsers on the registry.
import { proParser } from "./pro";
import { mapParser } from "./map";
import { parserRegistry } from "./registry";
parserRegistry.register(proParser);
parserRegistry.register(mapParser);
