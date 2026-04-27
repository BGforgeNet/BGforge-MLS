/**
 * Add/remove pathway for variable-length arrays in MAP files.
 *
 * Strategy: read the canonical document, mutate the array (and the linked
 * count field that mirrors its length), serialize via the existing
 * canonical writer, and let the caller reparse. Keeps add/remove on the
 * same byte-rebuild pipeline as every other MAP write — no buffer splicing.
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
 *   extent — but each slot's serialised width is selected by `getScriptType`
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
 */

import type { ParseResult } from "../types";
import { isArraySpec } from "../spec/types";
import { getMapCanonicalDocument, rebuildMapCanonicalDocument } from "./canonical-reader";
import { serializeMapCanonicalDocument } from "./canonical-writer";
import type { MapCanonicalDocument } from "./canonical-schemas";
import { varSectionSpec } from "./specs/variables";

function readDocument(parseResult: ParseResult): MapCanonicalDocument | undefined {
    return getMapCanonicalDocument(parseResult) ?? rebuildMapCanonicalDocument(parseResult);
}

/**
 * Per-section binding from a parsed-tree group name (the label the parser
 * emits) to the canonical-doc keys that mirror it. This is the only
 * legitimately per-format work — the *capabilities* (addable/removable,
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

export function buildMapAddEntryBytes(parseResult: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined {
    if (!isMapAddableArray(arrayPath)) return undefined;
    const doc = readDocument(parseResult);
    if (!doc) return undefined;

    const section = findVarSectionByArrayName(arrayPath[0]);
    if (!section) return undefined;

    const nextValues = [...doc[section.arrayKey], defaultVarValue()];
    return serializeMapCanonicalDocument(applyVarSectionUpdate(doc, section, nextValues), parseResult.opaqueRanges);
}

function findVarSectionByArrayName(name: string | undefined): VarSection | undefined {
    return VAR_SECTIONS.find((entry) => entry.arrayName === name);
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
    entryPath: readonly string[],
): Uint8Array | undefined {
    if (!isMapRemovableEntry(entryPath)) return undefined;
    return mutateVarSectionEntry(parseResult, entryPath, (values, index) => [
        ...values.slice(0, index),
        ...values.slice(index + 1),
    ]);
}

export function buildMapInsertEntryBytes(
    parseResult: ParseResult,
    entryPath: readonly string[],
    position: "before" | "after",
): Uint8Array | undefined {
    // An entry can be inserted next to any entry that itself is recognised as
    // a removable target — the addressing rules are the same.
    if (!isMapRemovableEntry(entryPath)) return undefined;
    return mutateVarSectionEntry(parseResult, entryPath, (values, index) => {
        const insertAt = position === "before" ? index : index + 1;
        return [...values.slice(0, insertAt), defaultVarValue(), ...values.slice(insertAt)];
    });
}

export function buildMapMoveEntryBytes(
    parseResult: ParseResult,
    entryPath: readonly string[],
    direction: "up" | "down",
): Uint8Array | undefined {
    if (!isMapRemovableEntry(entryPath)) return undefined;
    return mutateVarSectionEntry(parseResult, entryPath, (values, index) => {
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= values.length) return undefined;
        const next = [...values];
        [next[index], next[targetIndex]] = [next[targetIndex]!, next[index]!];
        return next;
    });
}

/**
 * Shared boilerplate for entry-targeted var-section mutations: resolves the
 * binding row, runs the mutator on the current values, and re-serialises.
 * The mutator may return `undefined` to abort (e.g., move at the boundary).
 */
function mutateVarSectionEntry(
    parseResult: ParseResult,
    entryPath: readonly string[],
    mutate: (values: readonly number[], index: number) => readonly number[] | undefined,
): Uint8Array | undefined {
    const doc = readDocument(parseResult);
    if (!doc) return undefined;
    const section = findVarSectionByArrayName(entryPath[0])!;
    const index = parseEntryIndex(entryPath[1]!, section.entryPrefix)!;
    const current = doc[section.arrayKey];
    if (index >= current.length) return undefined;

    const nextValues = mutate(current, index);
    if (!nextValues) return undefined;

    return serializeMapCanonicalDocument(
        applyVarSectionUpdate(doc, section, [...nextValues]),
        parseResult.opaqueRanges,
    );
}
