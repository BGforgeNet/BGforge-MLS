/**
 * Add/remove pathway for variable-length arrays in MAP files.
 *
 * Strategy: read the canonical document, mutate the array (and the linked
 * count field that mirrors its length), serialize via the existing
 * canonical writer, and let the caller reparse. Keeps add/remove on the
 * same byte-rebuild pipeline as every other MAP write — no buffer splicing.
 */

import type { ParseResult } from "../types";
import { isArraySpec } from "../spec/types";
import { getMapCanonicalDocument, rebuildMapCanonicalDocument } from "./canonical-reader";
import { serializeMapCanonicalDocument } from "./canonical-writer";
import type { MapCanonicalDocument } from "./canonical-schemas";
import { findMapObjectVariant, MAP_OBJECT_VARIANTS } from "./specs/object-variants";
import { varSectionSpec } from "./specs/variables";

type MapObject = MapCanonicalDocument["objects"]["elevations"][number]["objects"][number];

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

export function buildMapAddEntryBytes(
    parseResult: ParseResult,
    arrayPath: readonly string[],
    options?: { readonly variantId?: string },
): Uint8Array | undefined {
    if (ENABLE_PER_ELEVATION_OBJECT_ENTITY_OPS && isPerElevationObjectsPath(arrayPath)) {
        return buildAddObjectAtElevation(parseResult, arrayPath, options);
    }
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

/**
 * Per-elevation object add/remove is gated until the canonical-writer
 * round-trip stops losing the objects section on real fixtures (see
 * `docs/todo.md` v2.5). The byte-builders + variants registry are staged
 * here so the fix is a one-line flip; today they are unreachable from the
 * UI because the predicates below return false for object paths.
 */
const ENABLE_PER_ELEVATION_OBJECT_ENTITY_OPS = false;

export function isMapAddableArray(arrayPath: readonly string[]): boolean {
    if (ENABLE_PER_ELEVATION_OBJECT_ENTITY_OPS && isPerElevationObjectsPath(arrayPath)) return true;
    if (!varSectionAddable || arrayPath.length !== 1) return false;
    return findVarSectionByArrayName(arrayPath[0]) !== undefined;
}

export function isMapRemovableEntry(entryPath: readonly string[]): boolean {
    if (ENABLE_PER_ELEVATION_OBJECT_ENTITY_OPS && isPerElevationObjectEntryPath(entryPath)) return true;
    if (!varSectionRemovable || entryPath.length !== 2) return false;
    const [arrayName, entryName] = entryPath;
    const section = findVarSectionByArrayName(arrayName);
    if (!section || entryName === undefined) return false;
    return parseEntryIndex(entryName, section.entryPrefix) !== undefined;
}

export function getMapArrayVariants(
    arrayPath: readonly string[],
): readonly { id: string; label: string }[] | undefined {
    if (!ENABLE_PER_ELEVATION_OBJECT_ENTITY_OPS || !isPerElevationObjectsPath(arrayPath)) return undefined;
    return MAP_OBJECT_VARIANTS.map(({ id, label }) => ({ id, label }));
}

// -- Per-elevation object array helpers ------------------------------------

const ELEVATION_OBJECTS_RE = /^Elevation (\d+) Objects$/;
const OBJECT_ENTRY_RE = /^Object (\d+)\.(\d+) /;

function isPerElevationObjectsPath(arrayPath: readonly string[]): boolean {
    return (
        arrayPath.length === 2 && arrayPath[0] === "Objects Section" && ELEVATION_OBJECTS_RE.test(arrayPath[1] ?? "")
    );
}

function isPerElevationObjectEntryPath(entryPath: readonly string[]): boolean {
    return (
        entryPath.length === 3 &&
        entryPath[0] === "Objects Section" &&
        ELEVATION_OBJECTS_RE.test(entryPath[1] ?? "") &&
        OBJECT_ENTRY_RE.test(entryPath[2] ?? "")
    );
}

function elevationIndexFromArrayName(name: string): number | undefined {
    const match = ELEVATION_OBJECTS_RE.exec(name);
    if (!match || match[1] === undefined) return undefined;
    const index = Number.parseInt(match[1], 10);
    return Number.isInteger(index) && index >= 0 && index <= 2 ? index : undefined;
}

function objectIndexFromEntryName(name: string): number | undefined {
    const match = OBJECT_ENTRY_RE.exec(name);
    if (!match || match[2] === undefined) return undefined;
    const index = Number.parseInt(match[2], 10);
    return Number.isInteger(index) && index >= 0 ? index : undefined;
}

function applyObjectsUpdate(
    doc: MapCanonicalDocument,
    elevationIndex: number,
    nextObjects: readonly MapObject[],
): MapCanonicalDocument {
    const elevations = doc.objects.elevations.map((entry, i) =>
        i === elevationIndex ? { ...entry, objects: [...nextObjects], objectCount: nextObjects.length } : entry,
    );
    const totalObjects = elevations.reduce((sum, entry) => sum + entry.objects.length, 0);
    return { ...doc, objects: { ...doc.objects, totalObjects, elevations } };
}

/**
 * Real-world maps carry an `objects-tail` opaque range covering the bytes
 * between the parser's last-decoded object and the end of file (junk the
 * parser couldn't safely decode without external PRO metadata, plus padding
 * fields the format reserves but ships zeroed). When the user mutates the
 * objects section, that opaque range becomes invalid — copying it back into
 * the output buffer at its original offset would overwrite the freshly-
 * inserted object's bytes. Drop it for object-section operations.
 */
function opaqueRangesForObjectMutation(parseResult: ParseResult) {
    return (parseResult.opaqueRanges ?? []).filter((range) => range.label !== "objects-tail");
}

function buildAddObjectAtElevation(
    parseResult: ParseResult,
    arrayPath: readonly string[],
    options: { readonly variantId?: string } | undefined,
): Uint8Array | undefined {
    const variant = findMapObjectVariant(options?.variantId);
    if (!variant) return undefined;
    const elevationIndex = elevationIndexFromArrayName(arrayPath[1] ?? "");
    if (elevationIndex === undefined) return undefined;

    const doc = readDocument(parseResult);
    if (!doc) return undefined;
    const elevation = doc.objects.elevations[elevationIndex];
    if (!elevation) return undefined;

    const nextObjects = [...elevation.objects, variant.defaultElement()];
    return serializeMapCanonicalDocument(
        applyObjectsUpdate(doc, elevationIndex, nextObjects),
        opaqueRangesForObjectMutation(parseResult),
    );
}

function buildRemoveObjectAtElevation(parseResult: ParseResult, entryPath: readonly string[]): Uint8Array | undefined {
    const elevationIndex = elevationIndexFromArrayName(entryPath[1] ?? "");
    const objectIndex = objectIndexFromEntryName(entryPath[2] ?? "");
    if (elevationIndex === undefined || objectIndex === undefined) return undefined;

    const doc = readDocument(parseResult);
    if (!doc) return undefined;
    const elevation = doc.objects.elevations[elevationIndex];
    if (!elevation || objectIndex >= elevation.objects.length) return undefined;

    const nextObjects = [...elevation.objects.slice(0, objectIndex), ...elevation.objects.slice(objectIndex + 1)];
    return serializeMapCanonicalDocument(
        applyObjectsUpdate(doc, elevationIndex, nextObjects),
        opaqueRangesForObjectMutation(parseResult),
    );
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
    if (ENABLE_PER_ELEVATION_OBJECT_ENTITY_OPS && isPerElevationObjectEntryPath(entryPath)) {
        return buildRemoveObjectAtElevation(parseResult, entryPath);
    }
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
