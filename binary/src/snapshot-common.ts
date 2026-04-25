import { resolveRawValueFromDisplay } from "./display-lookups";
import { createFieldKey, toSemanticFieldKey } from "./presentation-schema";
import type { ParsedField } from "./types";

export function slugify(label: string): string {
    const normalized = label
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[^A-Za-z0-9]+/g, " ")
        .trim()
        .toLowerCase();

    if (!normalized) {
        return "field";
    }

    const parts = normalized.split(/\s+/);
    return parts.map((part, index) => (index === 0 ? part : `${part[0]!.toUpperCase()}${part.slice(1)}`)).join("");
}

export function makeUniqueKey(baseKey: string, usedKeys: Map<string, number>): string {
    const count = usedKeys.get(baseKey) ?? 0;
    usedKeys.set(baseKey, count + 1);
    return count === 0 ? baseKey : `${baseKey}${count + 1}`;
}

export function parseScalarFieldValue(
    format: string,
    fieldKey: string,
    field: ParsedField,
): string | number | boolean | null {
    if (typeof field.rawValue === "number" || typeof field.rawValue === "string") {
        return field.rawValue;
    }

    if (
        typeof field.value === "number" ||
        typeof field.value === "string" ||
        typeof field.value === "boolean" ||
        field.value === null
    ) {
        if (typeof field.value === "string") {
            const lookedUp = resolveRawValueFromDisplay(format, fieldKey, field.name, field.value);
            if (lookedUp !== undefined) {
                return lookedUp;
            }

            if (/^0x[0-9a-f]+$/i.test(field.value)) {
                return Number.parseInt(field.value, 16);
            }

            if (/^-?\d+%$/.test(field.value)) {
                return Number.parseInt(field.value, 10);
            }
        }

        return field.value;
    }

    return JSON.stringify(field.value);
}

export function getScalarFieldLookupKey(format: string, fieldSegments: readonly string[]): string {
    return toSemanticFieldKey(format, fieldSegments) ?? createFieldKey(fieldSegments);
}
