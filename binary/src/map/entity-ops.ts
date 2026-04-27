/**
 * Add/remove pathway for variable-length arrays in MAP files.
 *
 * Strategy: read the canonical document, mutate the array (and the linked
 * count field that mirrors its length), serialize via the existing
 * canonical writer, and let the caller reparse. Keeps add/remove on the
 * same byte-rebuild pipeline as every other MAP write — no buffer splicing.
 */

import type { ParseResult } from "../types";
import { getMapCanonicalDocument, rebuildMapCanonicalDocument } from "./canonical-reader";
import { serializeMapCanonicalDocument } from "./canonical-writer";
import type { MapCanonicalDocument } from "./canonical-schemas";

function readDocument(parseResult: ParseResult): MapCanonicalDocument | undefined {
    return getMapCanonicalDocument(parseResult) ?? rebuildMapCanonicalDocument(parseResult);
}

/**
 * Variable-length array sections backed by an int32 slot count, with the
 * count mirrored in the header. Adding a format = appending a row here.
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
    const doc = readDocument(parseResult);
    if (!doc || arrayPath.length !== 1) return undefined;

    const section = VAR_SECTIONS.find((entry) => entry.arrayName === arrayPath[0]);
    if (!section) return undefined;

    const nextValues = [...doc[section.arrayKey], 0];
    return serializeMapCanonicalDocument(applyVarSectionUpdate(doc, section, nextValues), parseResult.opaqueRanges);
}

export function isMapAddableArray(arrayPath: readonly string[]): boolean {
    return arrayPath.length === 1 && VAR_SECTIONS.some((entry) => entry.arrayName === arrayPath[0]);
}

export function isMapRemovableEntry(entryPath: readonly string[]): boolean {
    if (entryPath.length !== 2) return false;
    const [arrayName, entryName] = entryPath;
    const section = VAR_SECTIONS.find((entry) => entry.arrayName === arrayName);
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
    const doc = readDocument(parseResult);
    if (!doc || entryPath.length !== 2) return undefined;

    const [arrayName, entryName] = entryPath;
    const section = VAR_SECTIONS.find((entry) => entry.arrayName === arrayName);
    if (!section || entryName === undefined) return undefined;

    const index = parseEntryIndex(entryName, section.entryPrefix);
    if (index === undefined) return undefined;
    const current = doc[section.arrayKey];
    if (index >= current.length) return undefined;

    const nextValues = [...current.slice(0, index), ...current.slice(index + 1)];
    return serializeMapCanonicalDocument(applyVarSectionUpdate(doc, section, nextValues), parseResult.opaqueRanges);
}
