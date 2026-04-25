/**
 * Shared format options utilities.
 * Extracts indent size and line length from editorconfig.
 */

import { fileURLToPath } from "url";
import { getEditorconfigSettings } from "@bgforge/format";

const DEFAULT_INDENT = 4;
const DEFAULT_LINE_LIMIT = 120;

interface FormatOptions {
    indentSize: number;
    lineLimit: number;
}

/**
 * Get format options from editorconfig for a given file URI.
 * Falls back to defaults if editorconfig is not found or cannot be read.
 */
export function getFormatOptions(uri: string): FormatOptions {
    try {
        const filePath = fileURLToPath(uri);
        const settings = getEditorconfigSettings(filePath);
        return {
            indentSize: settings.indentSize ?? DEFAULT_INDENT,
            lineLimit: settings.maxLineLength ?? DEFAULT_LINE_LIMIT,
        };
    } catch {
        return { indentSize: DEFAULT_INDENT, lineLimit: DEFAULT_LINE_LIMIT };
    }
}
