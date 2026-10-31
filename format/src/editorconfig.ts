/**
 * Shared editorconfig utilities: a small `.editorconfig` reader for the two properties the formatters use.
 * Hand-rolled because the `editorconfig` npm package depends on @one-ini/wasm, whose .wasm file does not bundle
 * with esbuild; verify that dependency has changed before proposing the swap.
 */

import * as fs from "fs";
import * as path from "path";

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

interface EditorconfigSection {
    glob: string;
    /** Keys lowercased, values as written; a repeated key keeps its last value. */
    properties: Map<string, string>;
}

interface EditorconfigFile {
    root: boolean;
    sections: EditorconfigSection[];
}

/**
 * Parses `.editorconfig` text: `[glob]` section headers over `key = value` lines, full-line `#` and `;` comments,
 * keys case-insensitive. Before the first section only `root` means anything. Throws, naming the file and line, on
 * a line that is none of these.
 */
function parseEditorconfig(content: string, configPath: string): EditorconfigFile {
    const file: EditorconfigFile = { root: false, sections: [] };
    let section: EditorconfigSection | undefined;
    const lines = content.split(/\r?\n/);
    for (const [index, rawLine] of lines.entries()) {
        const line = rawLine.trim();
        if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
        if (line.startsWith("[") && line.endsWith("]")) {
            section = { glob: line.slice(1, -1), properties: new Map() };
            file.sections.push(section);
            continue;
        }
        const eq = line.indexOf("=");
        if (eq <= 0) {
            throw new Error(
                `${configPath}:${index + 1}: expected a [section] header or a key = value line, got ${JSON.stringify(line)}`,
            );
        }
        const key = line.slice(0, eq).trim().toLowerCase();
        const value = line.slice(eq + 1).trim();
        if (section) section.properties.set(key, value);
        else if (key === "root") file.root = value.toLowerCase() === "true";
    }
    return file;
}

function readEditorconfig(configPath: string): EditorconfigFile {
    let content: string;
    try {
        content = fs.readFileSync(configPath, "utf-8");
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${configPath}: ${reason}`, { cause: error });
    }
    return parseEditorconfig(content, configPath);
}

/** A whole number from a property value; `off`, `tab`, an absent key or any other non-number gives null. */
function parseCount(value: string | undefined): number | null {
    const parsed = parseInt(value ?? "", 10);
    return isNaN(parsed) ? null : parsed;
}

/**
 * Gets indent_size and max_line_length for a file from the `.editorconfig` files above it, up to and including the
 * first with `root = true`. The nearest file wins; within a file, the last matching section wins. Throws when an
 * `.editorconfig` exists but cannot be read or parsed; an absent one is not an error.
 */
export function getEditorconfigSettings(filePath: string): EditorconfigResult {
    const fileName = path.basename(filePath);
    const chain: EditorconfigFile[] = [];
    let dir = path.dirname(filePath);
    for (;;) {
        const configPath = path.join(dir, ".editorconfig");
        if (fs.existsSync(configPath)) {
            const config = readEditorconfig(configPath);
            chain.push(config);
            if (config.root) break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    const properties = new Map<string, string>();
    for (const config of chain.toReversed()) {
        for (const section of config.sections) {
            if (!matchesGlob(fileName, section.glob)) continue;
            for (const [key, value] of section.properties) properties.set(key, value);
        }
    }
    return {
        indentSize: parseCount(properties.get("indent_size")),
        maxLineLength: parseCount(properties.get("max_line_length")),
    };
}
