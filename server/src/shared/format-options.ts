/**
 * Shared format options utilities.
 * Extracts indent size and line length from editorconfig.
 */

import { fileURLToPath } from "url";
import { getEditorconfigSettings } from "@bgforge/format";
import { conlog } from "../logger";

const DEFAULT_INDENT = 4;
const DEFAULT_LINE_LIMIT = 120;

interface FormatOptions {
    indentSize: number;
    lineLimit: number;
}

/**
 * Format options for a file URI, from the nearest `.editorconfig`. Falls back to defaults, which is the
 * right answer for a formatting request - refusing to format because a config is unreadable would be worse
 * - but the two ways of getting there are not the same and are no longer treated as one.
 */
export function getFormatOptions(uri: string): FormatOptions {
    const defaults = { indentSize: DEFAULT_INDENT, lineLimit: DEFAULT_LINE_LIMIT };

    let filePath: string;
    try {
        filePath = fileURLToPath(uri);
    } catch {
        // A URI with no filesystem path - an untitled buffer, or a virtual document such as the
        // decompiler's - has no `.editorconfig` to find by definition. Routine, so it stays quiet.
        return defaults;
    }

    try {
        const settings = getEditorconfigSettings(filePath);
        return {
            indentSize: settings.indentSize ?? DEFAULT_INDENT,
            lineLimit: settings.maxLineLength ?? DEFAULT_LINE_LIMIT,
        };
    } catch (error) {
        // An ABSENT `.editorconfig` never lands here - getEditorconfigSettings handles that itself and
        // returns nulls. Reaching this means one exists and could not be read, so the user's configured
        // indent is being silently replaced by ours on every format. Reported rather than swallowed.
        conlog(`cannot read .editorconfig for ${filePath}: ${(error as Error).message}`);
        return defaults;
    }
}
