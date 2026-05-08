/**
 * Shared editorconfig utilities.
 * Using 'ini' instead of 'editorconfig' package because editorconfig depends on
 * @one-ini/wasm which requires a .wasm file that doesn't bundle properly with esbuild.
 * The npm `editorconfig` package's WASM dependency has not changed; verify before
 * proposing the swap.
 */

import * as fs from "fs";
import * as path from "path";
import { parse as parseIni } from "ini";

/**
 * Simple glob matching for editorconfig patterns.
 *
 * Supported patterns:
 *   - `*`           - matches any filename
 *   - `*.ext`       - matches by single extension
 *   - `*.{a,b,c}`   - matches by extension list (brace expansion only)
 *   - exact filename match (no globbing)
 *
 * NOT supported (silently treated as non-match):
 *   - path-rooted patterns such as `[src/**.ssl]` or `subdir/*.tp2`
 *   - `**` recursive globs, character classes `[abc]`, negation `!`
 *
 * Path-rooted sections in a user's `.editorconfig` will not apply to formatting
 * even though the editor and other tooling honour them. If users report
 * formatter settings being ignored for path-qualified sections, this is the
 * function to extend.
 */
function matchesGlob(fileName: string, pattern: string): boolean {
    if (pattern === "*") return true;
    if (pattern.startsWith("*.")) {
        const extPattern = pattern.slice(2);
        const braceMatch = extPattern.match(/^\{(.+)\}$/);
        if (braceMatch && braceMatch[1]) {
            const extensions = braceMatch[1].split(",");
            return extensions.some((ext) => fileName.endsWith("." + ext.trim()));
        }
        return fileName.endsWith("." + extPattern);
    }
    return fileName === pattern;
}

/** Result from editorconfig parsing. */
interface EditorconfigResult {
    indentSize: number | null;
    maxLineLength: number | null;
}

/**
 * Gets formatting settings from .editorconfig files, walking up the directory tree.
 * Supports indent_size and max_line_length properties.
 */
export function getEditorconfigSettings(filePath: string): EditorconfigResult {
    const fileName = path.basename(filePath);
    let dir = path.dirname(filePath);
    const result: EditorconfigResult = { indentSize: null, maxLineLength: null };

    for (;;) {
        const configPath = path.join(dir, ".editorconfig");
        if (fs.existsSync(configPath)) {
            try {
                const content = fs.readFileSync(configPath, "utf-8");
                const config = parseIni(content);
                // Later matching sections override earlier ones
                for (const section of Object.keys(config)) {
                    if (matchesGlob(fileName, section)) {
                        const sectionConfig = config[section];

                        // indent_size
                        const indent = sectionConfig.indent_size;
                        if (typeof indent === "number") {
                            result.indentSize = indent;
                        } else if (typeof indent === "string") {
                            const parsed = parseInt(indent, 10);
                            if (!isNaN(parsed)) result.indentSize = parsed;
                        }

                        // max_line_length
                        const maxLen = sectionConfig.max_line_length;
                        if (typeof maxLen === "number") {
                            result.maxLineLength = maxLen;
                        } else if (typeof maxLen === "string" && maxLen !== "off") {
                            const parsed = parseInt(maxLen, 10);
                            if (!isNaN(parsed)) result.maxLineLength = parsed;
                        }
                    }
                }
                if (result.indentSize !== null && result.maxLineLength !== null) return result;
                if (config.root === true || config.root === "true") break;
            } catch {
                // Ignore read errors
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return result;
}
