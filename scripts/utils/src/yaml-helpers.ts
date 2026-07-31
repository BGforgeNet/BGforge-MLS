/**
 * Shared YAML and text helpers used by both ie-update and fallout-update scripts.
 * Provides string comparison, text dedentation, file discovery, and YAML utilities.
 */

import fs from "node:fs";
import path from "node:path";
import YAML, {
    type Document,
    type DocumentOptions,
    type ParseOptions,
    type Scalar,
    type SchemaOptions,
    isScalar,
    Scalar as ScalarClass,
} from "yaml";

/** A highlight pattern entry for tmLanguage YAML. */
export interface HighlightPattern {
    readonly match: string;
    readonly name?: string;
}

/**
 * Byte-level string comparison: sorts by character code (e.g. '_' after 'Z'),
 * unlike localeCompare, so generated output is deterministic across locales.
 */
export function cmpStr(a: string, b: string): number {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

/** YAML dump options for the data files: a wide lineWidth so entries never wrap, 2-space indent with
 * indented sequences - the format the checked-in `server/data/*.yml` files use. */
export const YAML_DUMP_OPTIONS = {
    lineWidth: 4096,
    indent: 2,
    indentSeq: true,
} as const;

/**
 * Dedents text by removing common leading whitespace. Block-scalar (|-)
 * emission is handled separately by makeBlockScalar at the serialization layer.
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
        // Sort entries alphabetically for deterministic cross-platform ordering
        // (raw directory order is filesystem-dependent).
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
 * Parses a YAML document and rejects duplicate map keys (and any other
 * structural error) by throwing. The default `parseDocument` records errors
 * on `doc.errors` but still yields a deduplicated document, so editing
 * pipelines that read -> mutate -> serialise would silently drop one of the
 * duplicate entries on the next write. Use this whenever the parsed YAML
 * is going to be edited and re-emitted, or whenever a duplicate key would
 * indicate a data-source mistake (typo, copy-paste).
 */
export function parseYamlDocStrict(
    source: string,
    options?: ParseOptions & DocumentOptions & SchemaOptions,
): Document.Parsed {
    const doc = YAML.parseDocument(source, options);
    if (doc.errors.length > 0) {
        throw new Error(doc.errors[0]!.message);
    }
    return doc;
}

/**
 * Creates a YAML Scalar node with literal block style (|-),
 * emitted as a block scalar regardless of content.
 */
export function makeBlockScalar(doc: Document, value: string): Scalar {
    const node = doc.createNode(value);
    if (!isScalar(node)) {
        throw new Error(`Expected Scalar node for string value, got ${typeof node}`);
    }
    node.type = ScalarClass.BLOCK_LITERAL;
    return node;
}
