import { z } from "zod";
import { resolveRawValueFromDisplay, resolveStoredFieldValue } from "./display-lookups";
import { opaqueRangeSchema } from "./shared-schemas";
import { formatAdapterRegistry } from "./format-adapter";
import { buildParsedTreeNode } from "./parsed-tree-codec";
import { createFieldKey, toSemanticFieldKey } from "./presentation-schema";
import type { ParseOpaqueRange, ParsedField, ParsedGroup, ParseOptions, ParseResult } from "./types";
import { getScalarFieldLookupKey, parseScalarFieldValue, slugify } from "./snapshot-common";

const valueSchema = z.union([z.number(), z.string(), z.boolean(), z.null()]);
const parsedFieldTypeSchema = z.enum([
    "enum",
    "flags",
    "string",
    "padding",
    "note",
    "uint8",
    "uint16",
    "uint24",
    "uint32",
    "int8",
    "int16",
    "int24",
    "int32",
]);

const binaryJsonFieldSchema = z.strictObject({
    nodeType: z.literal("field"),
    key: z.string().min(1),
    label: z.string().min(1),
    offset: z.number().int().min(0),
    size: z.number().int().min(0),
    valueType: parsedFieldTypeSchema,
    value: valueSchema,
    description: z.string().optional(),
});

type BinaryJsonField = z.infer<typeof binaryJsonFieldSchema>;

type BinaryJsonNode = BinaryJsonField | BinaryJsonGroup;

interface BinaryJsonGroup {
    readonly nodeType: "group";
    readonly key: string;
    readonly label: string;
    readonly description?: string;
    readonly expanded?: boolean;
    readonly children: BinaryJsonNode[];
}

const binaryJsonNodeSchema: z.ZodType<BinaryJsonNode> = z.lazy(() => z.union([
    binaryJsonFieldSchema,
    z.strictObject({
        nodeType: z.literal("group"),
        key: z.string().min(1),
        label: z.string().min(1),
        description: z.string().optional(),
        expanded: z.boolean().optional(),
        children: z.array(binaryJsonNodeSchema),
    }),
]));

const binaryJsonDocumentV1Schema = z.strictObject({
    schemaVersion: z.literal(1),
    format: z.string().min(1),
    formatName: z.string().min(1),
    root: z.strictObject({
        nodeType: z.literal("group"),
        key: z.string().min(1),
        label: z.string().min(1),
        description: z.string().optional(),
        expanded: z.boolean().optional(),
        children: z.array(binaryJsonNodeSchema),
    }),
    opaqueRanges: z.array(opaqueRangeSchema).optional(),
    warnings: z.array(z.string()).optional(),
    errors: z.array(z.string()).optional(),
});

type BinaryJsonDocumentV1 = z.infer<typeof binaryJsonDocumentV1Schema>;

function toBinaryJsonNode(
    format: string,
    entry: ParsedField | ParsedGroup,
    parentSegments: readonly string[],
    usedKeys: Map<string, number>,
): BinaryJsonNode {
    return buildParsedTreeNode(entry, parentSegments, usedKeys, {
        buildGroup: ({ entry: group, key, children }) => ({
            nodeType: "group",
            key,
            label: group.name,
            description: group.description,
            expanded: group.expanded,
            children,
        }),
        buildField: ({ entry: field, key, fieldSegments }) => ({
            nodeType: "field",
            key,
            label: field.name,
            description: field.description,
            offset: field.offset,
            size: field.size,
            valueType: field.type,
            value: parseScalarFieldValue(format, getScalarFieldLookupKey(format, fieldSegments), field),
        }),
    });
}

function createBinaryJsonDocument(parseResult: ParseResult): BinaryJsonDocumentV1 {
    const childKeys = new Map<string, number>();
    return {
        schemaVersion: 1,
        format: parseResult.format,
        formatName: parseResult.formatName,
        root: {
            nodeType: "group",
            key: slugify(parseResult.root.name),
            label: parseResult.root.name,
            description: parseResult.root.description,
            children: parseResult.root.fields.map((entry) => toBinaryJsonNode(parseResult.format, entry, [], childKeys)),
        },
        opaqueRanges: parseResult.opaqueRanges,
        warnings: parseResult.warnings,
        errors: parseResult.errors,
    };
}

function parseFieldValue(
    format: string,
    fieldKey: string,
    field: BinaryJsonField,
): { value: string | number | boolean | null; rawValue?: number | string } {
    if (typeof field.value === "number") {
        if (field.valueType === "enum" || field.valueType === "flags") {
            return {
                value: resolveStoredFieldValue(format, fieldKey, field.label, field.value),
                rawValue: field.value,
            };
        }

        return { value: field.value };
    }

    if (typeof field.value === "string") {
        if (field.valueType === "enum" || field.valueType === "flags") {
            const rawValue = resolveRawValueFromDisplay(format, fieldKey, field.label, field.value);
            if (rawValue !== undefined) {
                return {
                    value: resolveStoredFieldValue(format, fieldKey, field.label, rawValue),
                    rawValue,
                };
            }
        }

        return { value: field.value };
    }

    return { value: field.value };
}

function toParseResultNode(
    format: string,
    entry: BinaryJsonNode,
    parentSegments: readonly string[],
): ParsedField | ParsedGroup {
    const fieldSegments = [...parentSegments, entry.label];
    if (entry.nodeType === "group") {
        const group: ParsedGroup = {
            name: entry.label,
            fields: entry.children.map((child) => toParseResultNode(format, child, fieldSegments)),
        };
        if (entry.description !== undefined) {
            group.description = entry.description;
        }
        if (entry.expanded !== undefined) {
            group.expanded = entry.expanded;
        }
        return group;
    }

    const parsedValue = parseFieldValue(format, toSemanticFieldKey(format, fieldSegments) ?? createFieldKey(fieldSegments), entry);
    const field: ParsedField = {
        name: entry.label,
        offset: entry.offset,
        size: entry.size,
        type: entry.valueType,
        value: parsedValue.value,
    };
    if (entry.description !== undefined) {
        field.description = entry.description;
    }
    if (parsedValue.rawValue !== undefined) {
        field.rawValue = parsedValue.rawValue;
    }
    return field;
}

function fromBinaryJsonDocument(document: BinaryJsonDocumentV1): ParseResult {
    const result: ParseResult = {
        format: document.format,
        formatName: document.formatName,
        root: {
            name: document.root.label,
            fields: document.root.children.map((entry) => toParseResultNode(document.format, entry, [])),
        },
    };
    if (document.root.description !== undefined) {
        result.root.description = document.root.description;
    }
    if (document.root.expanded !== undefined) {
        result.root.expanded = document.root.expanded;
    }
    if (document.opaqueRanges !== undefined) {
        result.opaqueRanges = document.opaqueRanges as ParseOpaqueRange[];
    }
    if (document.warnings !== undefined) {
        result.warnings = document.warnings;
    }
    if (document.errors !== undefined) {
        result.errors = document.errors;
    }
    return result;
}

export function createBinaryJsonSnapshot(parseResult: ParseResult): string {
    const adapter = formatAdapterRegistry.get(parseResult.format);
    if (adapter) {
        return adapter.createJsonSnapshot(parseResult);
    }
    const document = binaryJsonDocumentV1Schema.parse(createBinaryJsonDocument(parseResult));
    return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseBinaryJsonSnapshot(jsonText: string): ParseResult {
    return loadBinaryJsonSnapshot(jsonText).parseResult;
}

export function loadBinaryJsonSnapshot(
    jsonText: string,
    options?: { proParseOptions?: ParseOptions; mapParseOptions?: ParseOptions },
): { parseResult: ParseResult; bytes?: Uint8Array } {
    try {
        const parsed = JSON.parse(jsonText) as unknown;
        if (typeof parsed === "object" && parsed !== null && "format" in parsed) {
            const format = (parsed as { format?: unknown }).format;
            if (typeof format === "string") {
                const adapter = formatAdapterRegistry.get(format);
                if (adapter) {
                    const parseOptions = format === "pro" ? options?.proParseOptions
                        : format === "map" ? options?.mapParseOptions
                            : undefined;
                    return adapter.loadJsonSnapshot(jsonText, parseOptions);
                }
            }
        }

        const document = binaryJsonDocumentV1Schema.parse(parsed);
        return { parseResult: fromBinaryJsonDocument(document) };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON snapshot: ${message}`, { cause: error });
    }
}
