import type { MapCanonicalDocument } from "./map/canonical";
import type { ProCanonicalDocument } from "./pro/canonical";

// Used only via ParseResult.document below; consumers see it through ParseResult,
// no downstream importer references the alias by name.
type BinaryCanonicalDocument = ProCanonicalDocument | MapCanonicalDocument;

export type ParsedFieldType =
    | "enum"
    | "flags"
    | "string"
    | "padding"
    | "note"
    | "uint8"
    | "uint16"
    | "uint24"
    | "uint32"
    | "int8"
    | "int16"
    | "int24"
    | "int32";

/**
 * Represents a parsed field in a binary structure
 */
export interface ParsedField {
    name: string;
    value: unknown;
    /** Raw value before any transformation */
    rawValue?: number | string;
    /** Offset in bytes from start of file */
    offset: number;
    /** Size in bytes */
    size: number;
    /** Binary/editor field kind */
    type: ParsedFieldType;
    /** Optional description of the field */
    description?: string;
}

/**
 * Represents a group of related fields
 */
export interface ParsedGroup {
    name: string;
    /** Optional description of the group */
    description?: string;
    fields: (ParsedField | ParsedGroup)[];
    /** Whether this group is expanded by default */
    expanded?: boolean;
}

// ParseDisplayModel + ParseSerializationContext exist only as composition pieces of
// ParseResult below; no downstream importer references either by name.
interface ParseDisplayModel {
    /** Parsed structure as groups and fields */
    root: ParsedGroup;
    /** Any warnings during parsing */
    warnings?: string[];
    /** Any errors during parsing */
    errors?: string[];
}

interface ParseSerializationContext {
    /** Original source bytes when they are needed to preserve undecoded or skipped regions */
    sourceData?: Uint8Array;
    /** Raw byte ranges preserved when parts of the format cannot be decoded structurally */
    opaqueRanges?: ParseOpaqueRange[];
}

/**
 * Result of parsing a binary file
 */
export interface ParseResult extends ParseDisplayModel, ParseSerializationContext {
    /** Format identifier (e.g., "pro", "frm", "map") */
    format: string;
    /** Human-readable format name */
    formatName: string;
    /** Format-specific canonical data model, separate from the editor/display tree */
    document?: BinaryCanonicalDocument;
}

/**
 * Raw byte range preserved in JSON for undecoded sections.
 * Bytes are chunked into short hex strings to keep diffs readable.
 */
export interface ParseOpaqueRange {
    label: string;
    offset: number;
    size: number;
    hexChunks: string[];
}

export interface ParseOptions {
    /**
     * Allow MAP files with ambiguous script/object boundaries to fall back to an
     * opaque object section instead of reporting a parse error.
     */
    gracefulMapBoundaries?: boolean;
    /**
     * Skip materializing MAP tile fields while still preserving the underlying
     * bytes for round-trip serialization.
     */
    skipMapTiles?: boolean;
}

/**
 * Interface for binary file parsers
 */
export interface BinaryParser {
    /** Unique identifier for this parser */
    readonly id: string;
    /** Human-readable name */
    readonly name: string;
    /** File extensions this parser handles (without dot) */
    readonly extensions: string[];
    /** Parse binary data and return structured result */
    parse(data: Uint8Array, options?: ParseOptions): ParseResult;
    /** Serialize structured result back to binary data (optional, for editors) */
    serialize?(result: ParseResult): Uint8Array;
}
