/**
 * Shared YAML and text helpers used by both ie-update and fallout-update scripts.
 * Provides string comparison, text dedentation, file discovery, and YAML utilities.
 */

import fs from "node:fs";
import path from "node:path";
import { type Document, type Scalar, isScalar, Scalar as ScalarClass } from "yaml";

/** A highlight pattern entry for tmLanguage YAML. */
export interface HighlightPattern {
    readonly match: string;
    readonly name?: string;
}

/**
 * Byte-level string comparison matching Python's default sort order.
 * Unlike localeCompare, this sorts by character code (e.g. '_' after 'Z').
 */
export function cmpStr(a: string, b: string): number {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

/** YAML dump options matching the Python ruamel.yaml configuration */
export const YAML_DUMP_OPTIONS = {
    lineWidth: 4096,
    indent: 2,
    indentSeq: true,
} as const;

/**
 * Dedents text by removing common leading whitespace.
 * Equivalent to Python's textwrap.dedent(string).
 * In Python, the result is wrapped in LiteralScalarString for |- block style,
 * but that's handled by makeBlockScalar at the YAML serialization layer.
 */
export function litscal(text: string): string {
    const lines = text.split("\n");
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    if (nonEmptyLines.length === 0) {
        return text;
    }

    const minIndent = nonEmptyLines.reduce((min, line) => {
        const match = line.match(/^(\s*)/);
        const indent = match?.[1]?.length ?? 0;
        return Math.min(min, indent);
    }, Infinity);

    if (minIndent > 0 && minIndent < Infinity) {
        return lines.map((line) => line.slice(minIndent)).join("\n");
    }
    return text;
}

/**
 * Recursively walks a directory, returning files matching the given extension.
 * Optionally skips specified directories and file names.
 */
export function findFiles(
    dirPath: string,
    ext: string,
    skipDirs: readonly string[] = [],
    skipFiles: readonly string[] = [],
): readonly string[] {
    const results: string[] = [];
    const extLower = `.${ext.toLowerCase()}`;

    function walk(dir: string): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        // Sort entries alphabetically for deterministic cross-platform ordering.
        // Python's os.walk uses inode order which is filesystem-dependent;
        // alphabetical sort ensures consistent results.
        entries.sort((a, b) => cmpStr(a.name, b.name));
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!skipDirs.includes(entry.name)) {
                    walk(fullPath);
                }
            } else if (entry.isFile()) {
                const fileExt = path.extname(entry.name).toLowerCase();
                if (fileExt === extLower && !skipFiles.includes(entry.name)) {
                    results.push(fullPath);
                }
            }
        }
    }

    walk(dirPath);
    return results;
}

/**
 * Creates a YAML Scalar node with literal block style (|-).
 * Matches Python ruamel.yaml's LiteralScalarString — always emits as a block scalar.
 */
export function makeBlockScalar(doc: Document, value: string): Scalar {
    const node = doc.createNode(value);
    if (!isScalar(node)) {
        throw new Error(`Expected Scalar node for string value, got ${typeof node}`);
    }
    node.type = ScalarClass.BLOCK_LITERAL;
    return node;
}
