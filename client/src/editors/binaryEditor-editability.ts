import { type ParsedField, resolveFieldPresentation } from "@bgforge/binary";

function isPotentiallyEditableValue(field: ParsedField): boolean {
    if (field.type === "enum" || field.type === "flags" || field.type.includes("int") || field.type.includes("uint")) {
        return true;
    }
    // Fixed-width string fields are editable in place: the byte budget is constant,
    // so the writer can truncate / NUL-pad without disturbing the file layout.
    // Zero-width strings are excluded — there's no buffer to write into.
    return field.type === "string" && field.size > 0;
}

export function isEditableFieldForFormat(format: string, fieldKey: string, field: ParsedField): boolean {
    if (!isPotentiallyEditableValue(field)) {
        return false;
    }

    const presentation = resolveFieldPresentation(format, fieldKey, field.name);
    if (presentation?.editable !== undefined) {
        return presentation.editable;
    }

    return true;
}
