import type { ExternalRef, FlagsRef } from "./spec/external-ref";
import type { CreCanonicalDocument } from "./cre/canonical";
import type { EffCanonicalDocument } from "./eff/canonical";
import type { ItmCanonicalDocument } from "./itm/canonical";
import type { DlgCanonicalDocument } from "./dlg/canonical-schemas";
import type { MapCanonicalDocument } from "./map/canonical";
import type { ProCanonicalDocument } from "./pro/canonical";
import type { SplCanonicalDocument } from "./spl/canonical";

// Used only via ParseResult.document below; consumers see it through ParseResult,
// no downstream importer references the alias by name.
type BinaryCanonicalDocument =
    | ProCanonicalDocument
    | MapCanonicalDocument
    | ItmCanonicalDocument
    | SplCanonicalDocument
    | EffCanonicalDocument
    | CreCanonicalDocument
    | DlgCanonicalDocument;

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
    /**
     * Spec-derived enum / flags lookup tables propagated alongside the field
     * so the renderer doesn't have to round-trip through the path-keyed
     * presentation schema. The path-keyed schema can't reach into
     * `view: "slots"` array children (each child shares the array's
     * semantic key); carrying the table on the field closes that gap and
     * makes the spec the single source of truth for enum/flags display.
     * Path-based overrides in the presentation schema still win when
     * present - the tree builder consults them first.
     */
    enumOptions?: Readonly<Record<string, string>>;
    flagOptions?: Readonly<Record<string, string>>;
    /** Display hint (from the spec's `enumOpen`): the enum table is advisory, not a closed value set, so the
     *  dropdown lets the user enter a custom numeric value (shown as "N Unknown"). Closed enums omit this. */
    enumOpen?: boolean;
    /**
     * Numeric display format (from the presentation `format` hint), carried so the editable control can
     * format AND parse the value: `hex32` shows/edits `0x...`. Display-only - `rawValue` stays the stored
     * number, so the round-trip is byte-identical. (Signedness is the codec's job, not a display format.)
     */
    numericFormat?: "hex32";
    /**
     * Display hint (from the spec's `hidden` flag): omit this field from the rendered detail form. The field
     * stays in the display tree with its value intact, so the byte round-trip is unaffected (the rebuilder
     * reads it back by label) - only the editor view skips rendering it. Used for reserved/padding/magic
     * fields (signature/version duplicates, `unused*`, `unknown`) that carry no value the user edits.
     */
    hidden?: boolean;
    /**
     * Display hint (from the spec's `ref`): the value points at data outside this file, so a consumer holding
     * the game can resolve it - a `dialog.tlk` line for a strref, and so on per kind. The field keeps its own
     * `type` and is still edited and validated as that type; this library never resolves a ref itself, having
     * no game context (see `spec/external-ref.ts`).
     */
    ref?: ExternalRef;
    /**
     * Display hint (from the spec's `flagsRef`): what this bitfield's individual BITS refer to outside the
     * file, for a consumer holding the game to resolve. `ref` above resolves the field's VALUE; a bitfield can
     * carry both. Reported only - the library resolves neither.
     */
    flagsRef?: FlagsRef;
    /**
     * This field is one slot of an array whose slots are NAMED by an external source (e.g. a CRE sound slot,
     * named by an IDS table the game ships). Distinct from `ref` above, which resolves the field's VALUE - a
     * slot commonly carries both, and a consumer must apply each. Like `ref`, the library only reports it: the
     * mapping is per-install, so a consumer holding the game resolves it and falls back to the generic label.
     */
    slotRef?: { ref: ExternalRef; index: number };
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
    /**
     * Display hint: render this group's scalar fields in N columns instead of the form's default. Set by the
     * `view: "slots"` walker for a small fixed slot array (e.g. ITM ability Melee Animation's 3 named slots)
     * so the slots sit on one row rather than wrapping awkwardly in the 2-column detail grid. Presentation
     * only - it carries no structural meaning.
     */
    columns?: number;
    /**
     * Set when the parser couldn't fully decode this record's wire layout
     * (e.g. a MAP object whose subtype payload is described by an unavailable
     * `.pro` file). The group's already-decoded fields render for inspection,
     * but editors must not expose field edits inside it: width-preserving
     * field changes are not interpretation-preserving when the byte width
     * of the rest of the record - and therefore where downstream sections
     * actually start - depends on undecoded data. Propagates to descendants;
     * the tree builder threads it down so individual fields show as
     * non-editable.
     */
    editingLocked?: boolean;
    /** Display hint: omit this group from the rendered detail form (mirrors `ParsedField.hidden`). The group
     *  stays in the tree for the byte round-trip; only the editor view skips it. */
    hidden?: boolean;
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
    /**
     * Layout-variant id the parser reports for object/sub-type dispatch (e.g. "critter",
     * "item.weapon"). Selects the matching variant from the format's declarative `layout`.
     * Optional in the type, but every shipped format's parser reports one; a result without a
     * matching variant yields no layout and the webview shows its error banner (the former
     * tabs fallback is retired - see binary-editor's `buildLayout`).
     */
    variantId?: string;
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
    /**
     * Override the default pid -> subType resolver used when decoding the
     * trailing per-subtype payload of MAP item / scenery records. Defaults to
     * the bundled vanilla Fallout 2 table (`pid-resolver.ts`). Supplying a
     * resolver lets callers extend coverage to modded pids that the bundled
     * table doesn't include. Returning `undefined` for a pid keeps the legacy
     * opaque-tail fallback for that record.
     */
    pidResolver?: (pid: number) => number | undefined;
}

/**
 * Which game's formats a parser reads.
 *
 * The families collide on extensions - a Fallout `.pro` is a PROTOTYPE, an Infinity Engine `.pro` is a
 * PROJECTILE - so an extension alone cannot say whether any parser reads a given file, and a lookup by
 * extension answers about whichever family registered it. A caller that knows which game a resource came from
 * passes the family and gets a truthful answer instead.
 */
export type GameFamily = "fallout" | "infinity-engine";

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
    /** Which game's formats this parser reads - see `GameFamily` for why the extension is not enough. */
    readonly family: GameFamily;
    /** Parse binary data and return structured result */
    parse(data: Uint8Array, options?: ParseOptions): ParseResult;
    /** Serialize structured result back to binary data (optional, for editors) */
    serialize?(result: ParseResult): Uint8Array;
}
