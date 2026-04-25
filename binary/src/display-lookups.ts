import { isFlagActive } from "./flags";
import { resolveFieldPresentation, toNumericOptionMap } from "./presentation-schema";

export function resolveEnumLookup(
    format: string,
    fieldKey: string,
    fieldName: string,
): Record<number, string> | undefined {
    const presentation = resolveFieldPresentation(format, fieldKey, fieldName);
    return presentation?.presentationType === "enum" ? toNumericOptionMap(presentation.enumOptions) : undefined;
}

export function resolveFlagLookup(
    format: string,
    fieldKey: string,
    fieldName: string,
): Record<number, string> | undefined {
    const presentation = resolveFieldPresentation(format, fieldKey, fieldName);
    return presentation?.presentationType === "flags" ? toNumericOptionMap(presentation.flagOptions) : undefined;
}

function getActiveFlagLabels(
    format: string,
    fieldKey: string,
    fieldName: string,
    rawValue: number,
): string[] | undefined {
    const presentation = resolveFieldPresentation(format, fieldKey, fieldName);
    if (presentation?.presentationType !== "flags" || !presentation.flagOptions) {
        return undefined;
    }

    return Object.entries(presentation.flagOptions)
        .filter(([bit]) => {
            const bitValue = Number(bit);
            const activation = presentation.flagActivation?.[bit] ?? (bitValue === 0 ? "equal" : "set");
            return isFlagActive(rawValue, bitValue, activation);
        })
        .map(([, label]) => label);
}

export function resolveDisplayValue(format: string, fieldKey: string, fieldName: string, rawValue: number): string {
    const enumTable = resolveEnumLookup(format, fieldKey, fieldName);
    if (enumTable) {
        const label = enumTable[rawValue];
        return label !== undefined ? formatEnumDisplayValue(label, rawValue) : `Unknown (${rawValue})`;
    }

    const flagTable = resolveFlagLookup(format, fieldKey, fieldName);
    if (flagTable) {
        const flags = getActiveFlagLabels(format, fieldKey, fieldName, rawValue) ?? [];
        return flags.length > 0 ? flags.join(", ") : "(none)";
    }

    return String(rawValue);
}

export function formatEnumDisplayValue(label: string, rawValue: number): string {
    return label === String(rawValue) ? label : `${label} (${rawValue})`;
}

export function resolveStoredFieldValue(format: string, fieldKey: string, fieldName: string, rawValue: number): string {
    const enumTable = resolveEnumLookup(format, fieldKey, fieldName);
    if (enumTable) {
        return enumTable[rawValue] ?? `Unknown (${rawValue})`;
    }

    const flagTable = resolveFlagLookup(format, fieldKey, fieldName);
    if (flagTable) {
        const flags = getActiveFlagLabels(format, fieldKey, fieldName, rawValue) ?? [];
        return flags.length > 0 ? flags.join(", ") : "(none)";
    }

    return String(rawValue);
}

// Strip a trailing " (123)" annotation produced by `formatEnumDisplayValue`.
// Implemented as an indexed scan rather than the natural `/\s+\((-?\d+)\)$/`
// because that pattern is polynomial: the `\s+...$` shape forces the engine
// to retry every starting position when the trailing parenthesised number is
// absent, giving O(n²) on inputs with long whitespace runs (CodeQL
// js/polynomial-redos). The display lookups are reachable from library
// callers via `@bgforge/binary`, so input is treated as untrusted.
function stripTrailingNumberParen(value: string): string {
    if (!value.endsWith(")")) return value;
    const open = value.lastIndexOf("(");
    if (open < 1) return value;
    if (!/^-?\d+$/.test(value.slice(open + 1, -1))) return value;
    const beforeOpen = value.slice(0, open);
    const stripped = beforeOpen.trimEnd();
    return stripped.length === beforeOpen.length ? value : stripped;
}

export function resolveRawValueFromDisplay(
    format: string,
    fieldKey: string,
    fieldName: string,
    value: string,
): number | undefined {
    const normalized = stripTrailingNumberParen(value);

    const enumTable = resolveEnumLookup(format, fieldKey, fieldName);
    if (enumTable) {
        for (const [raw, label] of Object.entries(enumTable)) {
            if (label === normalized) {
                return Number(raw);
            }
        }
    }

    const flagTable = resolveFlagLookup(format, fieldKey, fieldName);
    if (flagTable) {
        const presentation = resolveFieldPresentation(format, fieldKey, fieldName);
        let rawValue = 0;
        const parts = normalized
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean);
        if (parts.length === 1 && (parts[0] === "(none)" || parts[0] === "None")) {
            return 0;
        }

        const selectedLabels = new Set(parts);
        for (const [bit, label] of Object.entries(flagTable)) {
            const activation = presentation?.flagActivation?.[bit] ?? (Number(bit) === 0 ? "equal" : "set");
            const isSelected = selectedLabels.has(label);
            const bitValue = Number(bit);

            if (activation === "set") {
                if (isSelected) {
                    rawValue |= bitValue;
                }
                continue;
            }

            if (activation === "clear") {
                if (!isSelected) {
                    rawValue |= bitValue;
                }
                continue;
            }

            if (isSelected) {
                rawValue = bitValue;
            }
        }

        for (const part of parts) {
            const hasMatch = Object.values(flagTable).includes(part);
            if (!hasMatch) {
                return undefined;
            }
        }

        return rawValue;
    }

    return undefined;
}
