/**
 * Add/remove pathway for variable-length arrays in MAP files.
 *
 * Strategy: read the canonical document, mutate the array (and the linked
 * count field that mirrors its length), serialize via the existing
 * canonical writer, and let the caller reparse. Keeps add/remove on the
 * same byte-rebuild pipeline as every other MAP write - no buffer splicing.
 *
 * Scope is intentionally limited to header-counted uniform-int32 arrays
 * (Global/Local Variables). The objects section and the script section are
 * deliberately excluded:
 *
 * - Object records embed PIDs whose subtype payload layouts (Item, Scenery,
 *   Wall, Tile) are described in external `.pro` files that are not packaged
 *   alongside `.map` files in user mod trees. Without that metadata, the
 *   parser can't determine where each record ends, so the canonical doc can't
 *   represent the section completely enough to encode it deterministically
 *   after a structural mutation.
 *
 * - Script extents always carry 16 fixed slots regardless of `count`. Slots
 *   round-trip byte-identically because the canonical doc keeps all 16 per
 *   extent - but each slot's serialised width is selected by `getScriptType`
 *   on its sid byte, and the padding slots (`count..15`) carry whatever sid
 *   bits the engine had in scratch memory at the time of the original write.
 *   Adding a real slot in place of a padding one only stays width-neutral
 *   when the padding's accidental sid happens to match the script type the
 *   caller wants to add; otherwise the extent grows or shrinks, shifting
 *   downstream offsets. The writer's opaque-range mechanism replays trailers
 *   (`objects-tail`, `script-section-tail`) at their original parse-time
 *   offsets, so a downstream shift would clobber the trailer or leave a gap.
 *   Supporting structural script mutations therefore requires both the
 *   width-matching logic and a writer refactor that anchors trailing opaque
 *   ranges at the structural end offset rather than the original one.
 *
 * Field-level edits on already-decoded objects/scripts are width-preserving
 * and therefore safe; they go through the structural-edit pipeline directly,
 * not this module.
 *
 * Future hazard for new structural mutations (object type-tag transitions,
 * future buildStructuralTransitionBytes for MAP, anything else that changes
 * mid-file byte layout): `serializeMapCanonicalDocument` writes the new
 * sections at recomputed offsets but applies opaque ranges at their stored
 * offsets verbatim. Any range whose offset lies in or after the resized
 * region must be re-anchored in the new layout before serialization, or the
 * resulting bytes will be silently misaligned. The local helper
 * `shiftOpaqueRangesAfterVarSection` is specialised to the var-section
 * boundary; it is not a general "shift past offset X" - a structural
 * transition that resizes (e.g.) a single object record needs a new helper
 * that shifts opaque ranges past the resize point, or a writer mode that
 * re-anchors trailing ranges from semantic anchors instead of recorded
 * offsets. The misalignment is silent on the first operation when the
 * downstream section is opaque (skipMapTiles hides tile corruption), then
 * cascades into the next decoded section.
 */

import type { ParseOpaqueRange, ParseResult } from "../types";
import { isArraySpec } from "../spec/types";
import { applyEntryMutation, type EntryCollection } from "../spec/entity-ops";
import { getMapCanonicalDocument, rebuildMapCanonicalDocument } from "./canonical-reader";
import { serializeMapCanonicalDocument } from "./canonical-writer";
import type { MapCanonicalDocument } from "./canonical-schemas";
import { HEADER_SIZE } from "./schemas";
import { varSectionSpec } from "./specs/variables";

function readDocument(parseResult: ParseResult): MapCanonicalDocument | undefined {
    return getMapCanonicalDocument(parseResult) ?? rebuildMapCanonicalDocument(parseResult);
}

/**
 * Per-section binding from a parsed-tree group name (the label the parser
 * emits) to the canonical-doc keys that mirror it. This is the only
 * legitimately per-format work - the *capabilities* (addable/removable,
 * default element) come from the array spec itself, queried below. Adding
 * another header-counted variable section is one row in this table plus a
 * spec entry that already declares its own addable/defaultElement.
 */
interface VarSection {
    readonly arrayName: string;
    readonly entryPrefix: string;
    readonly arrayKey: "globalVariables" | "localVariables";
    readonly headerCountKey: "numGlobalVars" | "numLocalVars";
}

const VAR_SECTIONS: readonly VarSection[] = [
    {
        arrayName: "Global Variables",
        entryPrefix: "Global Var ",
        arrayKey: "globalVariables",
        headerCountKey: "numGlobalVars",
    },
    {
        arrayName: "Local Variables",
        entryPrefix: "Local Var ",
        arrayKey: "localVariables",
        headerCountKey: "numLocalVars",
    },
];

const varSectionValuesSpec = varSectionSpec.values;
const varSectionAddable = isArraySpec(varSectionValuesSpec) && varSectionValuesSpec.addable === true;
const varSectionRemovable = isArraySpec(varSectionValuesSpec) && varSectionValuesSpec.removable === true;

function defaultVarValue(): number {
    if (!isArraySpec(varSectionValuesSpec)) return 0;
    const value = varSectionValuesSpec.defaultElement?.();
    return typeof value === "number" ? value : 0;
}

function applyVarSectionUpdate(
    doc: MapCanonicalDocument,
    section: VarSection,
    nextValues: number[],
): MapCanonicalDocument {
    return {
        ...doc,
        [section.arrayKey]: nextValues,
        header: { ...doc.header, [section.headerCountKey]: nextValues.length },
    };
}

/** Build the format-general EntryCollection descriptor for a var section. MAP int32 arrays have no cross-references to relink. */
function makeVarSectionCollection(section: VarSection): EntryCollection<MapCanonicalDocument, number> {
    return {
        read: (doc) => doc[section.arrayKey],
        write: (doc, next) => applyVarSectionUpdate(doc, section, [...next]),
        defaultElement: defaultVarValue,
        addable: varSectionAddable,
        removable: varSectionRemovable,
    };
}

export function buildMapAddEntryBytes(parseResult: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined {
    if (!isMapAddableArray(arrayPath)) return undefined;
    const doc = readDocument(parseResult);
    if (!doc) return undefined;

    const section = findVarSectionByArrayName(arrayPath[0]);
    if (!section) return undefined;

    const collection = makeVarSectionCollection(section);
    const current = collection.read(doc);
    const mutation = applyEntryMutation(current, "add", current.length, collection.defaultElement);
    if (!mutation) return undefined;

    const nextDoc = collection.write(doc, mutation.next);
    return serializeMapCanonicalDocument(
        nextDoc,
        shiftOpaqueRangesAfterVarSection(parseResult.opaqueRanges, doc, section, +4),
    );
}

/**
 * The MAP writer applies opaque ranges at their stored offsets verbatim.
 * Adding or removing a var entry shifts every byte after that var section,
 * so any opaque range whose offset falls at-or-after the var-section
 * boundary in the OLD layout has to be re-anchored in the new layout -
 * otherwise the writer drops the opaque payload at the original (now-stale)
 * offset and the resulting bytes are misaligned by `delta`. The misalignment
 * is silent on the very first remove because skipMapTiles makes the corrupted
 * bytes invisible to the parser, but it accumulates across operations until
 * a downstream section (scripts/objects) trips a structural check and the
 * reparse finally errors out.
 *
 * `delta` is the byte change in the var-section size:
 *   add -> +4, remove -> -4, insert -> +4, move -> 0 (no shift needed; callers
 *   that don't change length pass 0 or skip this helper entirely).
 */
function shiftOpaqueRangesAfterVarSection(
    opaqueRanges: ParseOpaqueRange[] | undefined,
    doc: MapCanonicalDocument,
    section: VarSection,
    delta: number,
): ParseOpaqueRange[] | undefined {
    if (!opaqueRanges || delta === 0) return opaqueRanges;
    const cutoff =
        section.arrayKey === "globalVariables"
            ? HEADER_SIZE + doc.globalVariables.length * 4
            : HEADER_SIZE + (doc.globalVariables.length + doc.localVariables.length) * 4;
    return opaqueRanges.map((range) => (range.offset >= cutoff ? { ...range, offset: range.offset + delta } : range));
}

function findVarSectionByArrayName(name: string | undefined): VarSection | undefined {
    return VAR_SECTIONS.find((entry) => entry.arrayName === name);
}

export function isMapListSection(arrayPath: readonly string[]): boolean {
    return arrayPath.length === 1 && findVarSectionByArrayName(arrayPath[0]) !== undefined;
}

// Modifiability is the array-shape capability, independent of how many entries currently exist.
export function isMapModifiableArray(arrayPath: readonly string[]): boolean {
    return (varSectionAddable || varSectionRemovable) && isMapListSection(arrayPath);
}

export function isMapAddableArray(arrayPath: readonly string[]): boolean {
    if (!varSectionAddable || arrayPath.length !== 1) return false;
    return findVarSectionByArrayName(arrayPath[0]) !== undefined;
}

export function isMapRemovableEntry(entryPath: readonly string[]): boolean {
    if (!varSectionRemovable || entryPath.length !== 2) return false;
    const [arrayName, entryName] = entryPath;
    const section = findVarSectionByArrayName(arrayName);
    if (!section || entryName === undefined) return false;
    return parseEntryIndex(entryName, section.entryPrefix) !== undefined;
}

function parseEntryIndex(label: string, prefix: string): number | undefined {
    if (!label.startsWith(prefix)) return undefined;
    const index = Number.parseInt(label.slice(prefix.length), 10);
    return Number.isInteger(index) && index >= 0 ? index : undefined;
}

export function buildMapRemoveEntryBytes(
    parseResult: ParseResult,
    arrayPath: readonly string[],
    index: number,
): Uint8Array | undefined {
    return mutateVarSectionEntry(parseResult, arrayPath, index, "remove");
}

export function buildMapInsertEntryBytes(
    parseResult: ParseResult,
    arrayPath: readonly string[],
    index: number,
    position: "before" | "after",
): Uint8Array | undefined {
    return mutateVarSectionEntry(parseResult, arrayPath, index, "insert", position);
}

export function buildMapMoveEntryBytes(
    parseResult: ParseResult,
    arrayPath: readonly string[],
    index: number,
    direction: "up" | "down",
): Uint8Array | undefined {
    return mutateVarSectionEntry(parseResult, arrayPath, index, "reorder", undefined, direction);
}

/**
 * Copy the entry at `index` and insert the copy immediately after it.
 * MAP variables have no slot-unique identity to relink, so the copy is verbatim:
 * a var is just an int32 value.
 */
export function buildMapDuplicateEntryBytes(
    parseResult: ParseResult,
    arrayPath: readonly string[],
    index: number,
): Uint8Array | undefined {
    return mutateVarSectionEntry(parseResult, arrayPath, index, "duplicate");
}

/**
 * Shared boilerplate for entry-targeted var-section mutations: resolves the var
 * section from `arrayPath`, calls applyEntryMutation at the structural `index` on
 * the current values, and re-serialises. Returns undefined when `arrayPath` is not
 * a removable var section, `index` is out of range, or the op is a boundary no-op.
 */
function mutateVarSectionEntry(
    parseResult: ParseResult,
    arrayPath: readonly string[],
    index: number,
    op: "remove" | "insert" | "reorder" | "duplicate",
    position?: "before" | "after",
    direction?: "up" | "down",
): Uint8Array | undefined {
    if (!varSectionRemovable || arrayPath.length !== 1) return undefined;
    const section = findVarSectionByArrayName(arrayPath[0]);
    if (!section) return undefined;
    const doc = readDocument(parseResult);
    if (!doc) return undefined;
    const collection = makeVarSectionCollection(section);
    const current = collection.read(doc);
    if (index < 0 || index >= current.length) return undefined;

    const mutation = applyEntryMutation(current, op, index, collection.defaultElement, position, direction);
    if (!mutation) return undefined;

    const delta = mutation.delta * 4;
    const nextDoc = collection.write(doc, mutation.next);
    return serializeMapCanonicalDocument(
        nextDoc,
        shiftOpaqueRangesAfterVarSection(parseResult.opaqueRanges, doc, section, delta),
    );
}
