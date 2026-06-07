/**
 * BinaryFormatAdapter: per-format extension point for snapshot, presentation,
 * editor projection, and structural edit behaviour.
 *
 * Adapters are registered alongside parsers and eliminate format-specific
 * branching in the snapshot, presentation, editor, and validation layers.
 */

import { type NumericRange, setDomainRangeLookup } from "./binary-format-contract";
import type { CompiledPatternFieldPresentation, FormatPresentationSchema } from "./presentation-schema-types";
import type { FormatLayout } from "./layout-schema-types";
import type { ParsedField, ParsedGroup, ParseOptions, ParseResult } from "./types";

export type ProjectedEntry =
    | { readonly kind: "field"; readonly entry: ParsedField; readonly sourceSegments: readonly string[] }
    | {
          readonly kind: "group";
          readonly entry: ParsedGroup;
          readonly sourceSegments: readonly string[];
          readonly children: readonly ProjectedEntry[];
      };

export interface BinaryFormatAdapter {
    readonly formatId: string;

    // -- Per-format registries (consolidated to avoid parallel maps) ----------
    /**
     * Display labels, enum / flag dropdowns, and pattern overrides for the
     * binary editor. Consumed by `getFormatPresentationSchema` and
     * `resolveFieldPresentation`. Optional: a format with no presentation
     * data still works (every field falls back to humanize-derived labels
     * and walkStruct-resolved values).
     */
    readonly presentationSchema?: FormatPresentationSchema;
    /**
     * Pre-compiled regex versions of `presentationSchema.patternFields`.
     * Compiled once per format module load; cheaper than recompiling on
     * every `resolveFieldPresentation` call.
     */
    readonly compiledPatternFields?: readonly CompiledPatternFieldPresentation[];
    /**
     * Per-field domain ranges keyed by semantic field key. Tighter than the
     * codec's numeric-type range; used by editor value validation and the
     * canonical-write clamp path. Optional.
     */
    readonly domainRanges?: Readonly<Record<string, NumericRange>>;

    /**
     * How the editor invalidates this format's cached canonical `document` after a display-tree
     * mutation (field edit / structure op). Required so a new format must consciously choose rather
     * than silently inherit a reflection heuristic (review finding #6a):
     *  - "clear": the format caches a canonical document (own property or lazy getter/setter) that is
     *    rebuildable from the display tree; the editor sets `parseResult.document = undefined` so the
     *    next serialize/snapshot rebuilds from the edited tree. All current formats use this.
     *  - "none": the format keeps no editor-invalidatable cached document, or its document is
     *    authoritative and must NOT be cleared. The editor leaves `document` untouched.
     */
    readonly documentCacheStrategy: "clear" | "none";

    /**
     * Optional declarative layout. When present, the editor renders this format via the generic
     * layout renderer (panels/matrix/grid/flag-columns on a single dense page, variant chosen by the
     * parse result's `variantId`) instead of the legacy depth-0-groups-as-tabs path. Absent => the
     * format keeps the tabs path. This is presentation-only data (sibling of `presentationSchema`);
     * keep parser/codec free of it.
     */
    readonly layout?: FormatLayout;

    // -- Snapshots -------------------------------------------------------------
    createJsonSnapshot(parseResult: ParseResult): string;
    loadJsonSnapshot(jsonText: string, parseOptions?: ParseOptions): { parseResult: ParseResult; bytes?: Uint8Array };

    // -- Canonical document rebuild --------------------------------------------
    rebuildCanonicalDocument(parseResult: ParseResult): unknown | undefined;

    // -- Presentation ----------------------------------------------------------
    toSemanticFieldKey(segments: readonly string[]): string | undefined;

    // -- Editor projection (optional) ------------------------------------------
    shouldHideField?(entry: ParsedField): boolean;
    shouldHideGroup?(entry: ParsedGroup): boolean;
    projectDisplayRoot?(
        parseResult: ParseResult,
        projectEntry: (
            parseResult: ParseResult,
            entry: ParsedField | ParsedGroup,
            sourceSegments: readonly string[],
        ) => ProjectedEntry | undefined,
    ): ProjectedEntry[];

    // -- Structural edits (optional) -------------------------------------------
    isStructuralFieldId?(fieldId: string): boolean;
    buildStructuralTransitionBytes?(
        parseResult: ParseResult,
        fieldId: string,
        rawValue: number,
    ): Uint8Array | undefined;

    // -- Add/remove entries in variable-length arrays (optional) ---------------
    /**
     * Produce the bytes for `parseResult` with one new default entry appended
     * to the array at `arrayPath` (tree-segment names, e.g. `["Global Variables"]`).
     * Returns `undefined` if the path is not a known addable array for this
     * format.
     *
     * Adapters only declare arrays as addable when the entry's serialized
     * byte width is fully determined by the array spec - i.e., the format
     * can deterministically encode an inserted entry without external
     * metadata. Arrays whose entries depend on out-of-file resolution (e.g.,
     * MAP object records that need PRO subtype layouts) are not exposed
     * here; field-level edits on already-decoded entries remain possible.
     */
    buildAddEntryBytes?(parseResult: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined;
    /**
     * Produce the bytes for `parseResult` with the entry at ordinal `index` removed
     * from the array at `arrayPath` (tree-segment section names, e.g. `["Global Variables"]`).
     * `index` is the entry's 0-based position among its siblings, resolved by the editor
     * from structural identity (NodeId) - NOT parsed from a display label, so a relabel /
     * i18n / presentation override cannot misaddress the byte op. Returns `undefined` if
     * `arrayPath` is not a known mutable array or `index` is out of range for this format.
     */
    buildRemoveEntryBytes?(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ): Uint8Array | undefined;
    /**
     * Insert a new default entry adjacent to the entry at ordinal `index` in the array
     * at `arrayPath`. Used by the Insert before / Insert after editor actions for arrays
     * where slot index carries identity (e.g. MAP global vars referenced by index from
     * scripts). `index` is the structural ordinal (see `buildRemoveEntryBytes`).
     */
    buildInsertEntryBytes?(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        position: "before" | "after",
    ): Uint8Array | undefined;
    /**
     * Swap the entry at ordinal `index` in the array at `arrayPath` with its neighbour in
     * the given direction. Returns undefined when the move is at the array boundary (no-op)
     * or `arrayPath`/`index` is not a known movable entry. `index` is the structural ordinal.
     */
    buildMoveEntryBytes?(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        direction: "up" | "down",
    ): Uint8Array | undefined;
    /**
     * Duplicate the entry at ordinal `index` in the array at `arrayPath`: copy its data,
     * insert the copy immediately after it, then apply the per-format relink
     * (identity-freshening) where the format needs it. Returns undefined if `arrayPath`/`index`
     * is not a duplicable entry. Fixed-width entries with no slot-unique identity (MAP
     * variables) copy verbatim. `index` is the structural ordinal.
     */
    buildDuplicateEntryBytes?(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ): Uint8Array | undefined;
    /**
     * Lightweight predicate the byte-builders use to validate a removal target. The list-section
     * identity and structure-op affordances (canAdd/canModify) are now declared on the layout schema's
     * `list` block, not derived from the adapter - the adapter holds only data concerns.
     */
    isRemovableEntry?(entryPath: readonly string[]): boolean;
}

class FormatAdapterRegistry {
    private readonly adapters = new Map<string, BinaryFormatAdapter>();

    register(adapter: BinaryFormatAdapter): void {
        if (this.adapters.has(adapter.formatId)) {
            console.warn(`Format adapter "${adapter.formatId}" already registered, overwriting`);
        }
        this.adapters.set(adapter.formatId, adapter);
    }

    get(formatId: string): BinaryFormatAdapter | undefined {
        return this.adapters.get(formatId);
    }
}

export const formatAdapterRegistry = new FormatAdapterRegistry();

// Eagerly register every built-in format adapter, then install the
// registry-driven domain-range lookup into `binary-format-contract`. The
// setter pattern keeps `binary-format-contract` cycle-free: derive-zod
// and per-format canonical schemas import codec primitives from there
// without dragging in the format-adapter graph.
import { proFormatAdapter } from "./pro/format-adapter";
import { mapFormatAdapter } from "./map/format-adapter";
import { itmFormatAdapter } from "./itm/format-adapter";
import { splFormatAdapter } from "./spl/format-adapter";
import { effFormatAdapter } from "./eff/format-adapter";
import { creFormatAdapter } from "./cre/format-adapter";

formatAdapterRegistry.register(proFormatAdapter);
formatAdapterRegistry.register(mapFormatAdapter);
formatAdapterRegistry.register(itmFormatAdapter);
formatAdapterRegistry.register(splFormatAdapter);
formatAdapterRegistry.register(effFormatAdapter);
formatAdapterRegistry.register(creFormatAdapter);

setDomainRangeLookup((format, fieldKey) => formatAdapterRegistry.get(format)?.domainRanges?.[fieldKey]);
