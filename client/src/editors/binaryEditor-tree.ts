import {
    type ParseResult,
    type ParsedField,
    type ParsedGroup,
    type ProjectedEntry,
    formatAdapterRegistry,
    createFieldKey,
    resolveFieldPresentation,
    toSemanticFieldKey,
} from "@bgforge/binary";
import type { BinaryEditorNode } from "./binaryEditor-messages";
import { isEditableFieldForFormat } from "./binaryEditor-editability";
import { formatNumericValue } from "./binaryEditor-formatting";
import {
    resolveDisplayValue,
    resolveEnumLookup,
    resolveFlagLookup,
    resolveStringCharset,
} from "./binaryEditor-lookups";
import { resolveNumericFormat } from "./binaryEditor-numericFormat";

interface TreeNodeRecord {
    readonly id: string;
    readonly summary: BinaryEditorNode;
    readonly children: readonly string[];
}

function group(
    name: string,
    fields: (ParsedField | ParsedGroup)[],
    expanded = true,
    description?: string,
): ParsedGroup {
    return { name, fields, expanded, description };
}

function isGroup(entry: ParsedField | ParsedGroup): entry is ParsedGroup {
    return "fields" in entry;
}

function makeFieldPath(parentPath: string, name: string): string {
    return parentPath ? `${parentPath}.${name}` : name;
}

function makeFieldId(sourceSegments: readonly string[]): string {
    return JSON.stringify(sourceSegments);
}

export interface BinaryEditorTreeState {
    getInitMessagePayload(): {
        format: string;
        formatName: string;
        errors?: string[];
        warnings?: string[];
        rootChildren: BinaryEditorNode[];
    };
    getChildren(nodeId: string): BinaryEditorNode[];
}

function shouldHideFieldFromEditor(parseResult: ParseResult, entry: ParsedField): boolean {
    if (entry.name === "Unknown") {
        return true;
    }

    const adapter = formatAdapterRegistry.get(parseResult.format);
    return adapter?.shouldHideField?.(entry) ?? false;
}

function projectDisplayEntry(
    parseResult: ParseResult,
    entry: ParsedField | ParsedGroup,
    sourceSegments: readonly string[],
): ProjectedEntry | undefined {
    if (!isGroup(entry)) {
        return shouldHideFieldFromEditor(parseResult, entry) ? undefined : { kind: "field", entry, sourceSegments };
    }

    const projectedChildren = entry.fields
        .map((child) => projectDisplayEntry(parseResult, child, [...sourceSegments, child.name]))
        .filter((child): child is ProjectedEntry => child !== undefined);

    if (projectedChildren.length === 0) {
        return undefined;
    }

    const adapter = formatAdapterRegistry.get(parseResult.format);
    if (
        adapter?.shouldHideGroup?.(
            group(
                entry.name,
                projectedChildren.map((child) => child.entry),
                entry.expanded !== false,
                entry.description,
            ),
        )
    ) {
        return undefined;
    }

    return { kind: "group", entry, sourceSegments, children: projectedChildren };
}

function buildDisplayRoot(parseResult: ParseResult): ProjectedEntry[] {
    if (parseResult.errors && parseResult.errors.length > 0) {
        return [];
    }

    const adapter = formatAdapterRegistry.get(parseResult.format);
    const customRoot = adapter?.projectDisplayRoot?.(parseResult, projectDisplayEntry);
    if (customRoot) {
        return customRoot;
    }

    return parseResult.root.fields
        .map((entry) => projectDisplayEntry(parseResult, entry, [entry.name]))
        .filter((entry): entry is ProjectedEntry => entry !== undefined);
}

export function buildBinaryEditorTreeState(parseResult: ParseResult): BinaryEditorTreeState {
    const displayRoot = buildDisplayRoot(parseResult);
    const nodes = new Map<string, TreeNodeRecord>();
    const rootChildren: string[] = [];
    let nextId = 0;

    const adapter = formatAdapterRegistry.get(parseResult.format);
    // `locked` propagates from any ancestor `ParsedGroup.editingLocked` flag set
    // by the parser (e.g. a MAP record whose subtype payload couldn't be decoded
    // from external metadata). Field summaries inside a locked subtree report
    // `editable: false` regardless of the schema's per-field rule, since field
    // edits are only safe when the surrounding record's byte layout is fully
    // determined.
    const visitEntry = (projected: ProjectedEntry, parentId: string, parentPath: string, locked: boolean): string => {
        const id = `node-${nextId++}`;
        if (projected.kind === "group") {
            const entry = projected.entry;
            const groupPath = makeFieldPath(parentPath, entry.name);
            const childLocked = locked || entry.editingLocked === true;
            const childIds = projected.children.map((child) => visitEntry(child, id, groupPath, childLocked));
            const addable = adapter?.isAddableArray?.(projected.sourceSegments) === true;
            nodes.set(id, {
                id,
                children: childIds,
                summary: {
                    id,
                    parentId,
                    kind: "group",
                    name: entry.name,
                    description: entry.description,
                    expandable: childIds.length > 0,
                    expanded: entry.expanded !== false,
                    ...(addable ? { addable: true, arrayPath: projected.sourceSegments } : {}),
                },
            });
            return id;
        }

        const entry = projected.entry;
        const fieldPath = makeFieldPath(parentPath, entry.name);
        const fieldId = makeFieldId(projected.sourceSegments);
        const fieldKey =
            toSemanticFieldKey(parseResult.format, projected.sourceSegments) ??
            createFieldKey(projected.sourceSegments);
        const presentation = resolveFieldPresentation(parseResult.format, fieldKey, entry.name);
        const numericFormat = resolveNumericFormat(parseResult.format, fieldKey, entry.name);
        const enumOptions = resolveEnumLookup(parseResult.format, fieldKey, entry.name);
        const flagOptions = resolveFlagLookup(parseResult.format, fieldKey, entry.name);
        const numericValue =
            typeof entry.rawValue === "number"
                ? entry.rawValue
                : typeof entry.value === "number"
                  ? entry.value
                  : undefined;
        const displayValue =
            typeof numericValue === "number"
                ? enumOptions || flagOptions
                    ? resolveDisplayValue(parseResult.format, fieldKey, entry.name, numericValue)
                    : formatNumericValue(numericValue, numericFormat)
                : String(entry.value);
        nodes.set(id, {
            id,
            children: [],
            summary: {
                id,
                parentId,
                kind: "field",
                name: entry.name,
                description: entry.description,
                expandable: false,
                fieldId,
                fieldKey,
                fieldPath,
                editable: !locked && isEditableFieldForFormat(parseResult.format, fieldKey, entry),
                value: displayValue,
                rawValue: entry.rawValue,
                offset: entry.offset,
                size: entry.size,
                valueType: entry.type,
                numericFormat,
                enumOptions,
                flagOptions,
                flagActivation: presentation?.flagActivation,
                stringCharset:
                    entry.type === "string"
                        ? resolveStringCharset(parseResult.format, fieldKey, entry.name)
                        : undefined,
                ...(adapter?.isRemovableEntry?.(projected.sourceSegments) === true
                    ? { removable: true, entryPath: projected.sourceSegments }
                    : {}),
            },
        });
        return id;
    };

    for (const entry of displayRoot) {
        rootChildren.push(visitEntry(entry, "root", "", false));
    }

    return {
        getInitMessagePayload() {
            return {
                format: parseResult.format,
                formatName: parseResult.formatName,
                errors: parseResult.errors,
                warnings: parseResult.warnings,
                rootChildren: rootChildren.map((id) => nodes.get(id)!.summary),
            };
        },
        getChildren(nodeId: string) {
            const record = nodes.get(nodeId);
            if (!record) {
                return [];
            }
            return record.children.map((childId) => nodes.get(childId)!.summary);
        },
    };
}
