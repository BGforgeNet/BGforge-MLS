import { resolveFieldPresentation } from "@bgforge/binary";
import type { NumericFormat } from "./binaryEditor-formatting";

export function resolveNumericFormat(format: string, fieldKey: string, fieldName: string): NumericFormat {
    return resolveFieldPresentation(format, fieldKey, fieldName)?.numericFormat ?? "decimal";
}
