import { type ParsedField, resolveFieldPresentation } from "@bgforge/binary";

function isPotentiallyEditableValue(field: ParsedField): boolean {
    return field.type === "enum" || field.type === "flags" || field.type.includes("int") || field.type.includes("uint");
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
