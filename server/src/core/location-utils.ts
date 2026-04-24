/**
 * Location and path utilities.
 *
 * Provides validation and extraction utilities for file locations.
 * - Ensures Location objects returned to VSCode are valid and navigable
 * - Extracts path components from URIs
 * - Identifies header files by extension
 */

import { type Location } from "vscode-languageserver/node";
import { fileURLToPath } from "url";
import { basename, extname, relative } from "path";

/**
 * Check if a Location is valid for VSCode navigation.
 *
 * A Location is invalid if:
 * - It's null or undefined
 * - Its URI is empty or missing
 *
 * @param location - Location to validate
 * @returns true if the location can be navigated to
 */
function isValidLocation(location: Location | null | undefined): location is Location {
    if (!location) return false;
    if (!location.uri || location.uri === "") return false;
    return true;
}

/**
 * Return the location if valid, null otherwise.
 *
 * Use this in getSymbolDefinition implementations to ensure
 * we never return a Location with an empty URI to VSCode.
 *
 * @param location - Location to validate and return
 * @returns The location if valid, null otherwise
 */
export function validLocationOrNull(location: Location | null | undefined): Location | null {
    return isValidLocation(location) ? location : null;
}

/** Header file extensions by language. */
const HEADER_EXTENSIONS: ReadonlySet<string> = new Set([
    ".h", // Fallout SSL headers
    ".tph", // WeiDU TP2 headers
]);

/**
 * Check if a file path/URI points to a header file.
 *
 * Header files are identified by extension:
 * - `.h` - Fallout SSL headers
 * - `.tph` - WeiDU TP2 headers
 *
 * @param path - File path or URI to check
 * @returns true if the file is a header file
 */
export function isHeaderFile(path: string): boolean {
    const ext = extname(path).toLowerCase();
    return HEADER_EXTENSIONS.has(ext);
}

/**
 * Extract the filename from a path or URI.
 *
 * @param path - File path or URI
 * @returns Filename with extension (e.g., "utils.h" from "/path/to/utils.h")
 */
export function extractFilename(path: string): string {
    return basename(path);
}

/**
 * Compute a display path for hover/completion UI.
 *
 * Returns a path relative to workspaceRoot if possible,
 * otherwise falls back to filename only.
 *
 * @param uri - File URI (file:// protocol)
 * @param workspaceRoot - Workspace root path (optional)
 * @returns Relative path or filename for display
 */
export function computeDisplayPath(uri: string, workspaceRoot?: string): string {
    const absolutePath = fileURLToPath(uri);

    if (workspaceRoot) {
        const relativePath = relative(workspaceRoot, absolutePath);
        // relative() returns absolute path if file is outside workspace
        if (!relativePath.startsWith("..") && !relativePath.startsWith("/")) {
            return relativePath;
        }
    }

    // Fall back to filename only
    return basename(absolutePath);
}
