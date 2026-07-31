/**
 * Converts tmLanguage YAML syntax definitions to JSON.
 * Expands shorthand: inherits `name` fields from repository entries
 * to their child patterns that lack a `name` field.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/yaml2json.ts input.yml output.json
 */

import fs from "node:fs";
import YAML from "yaml";

interface PatternEntry {
    name?: string;
    match?: string;
    [key: string]: unknown;
}

interface RepositoryEntry {
    name?: string;
    patterns?: PatternEntry[];
    [key: string]: unknown;
}

interface TmLanguageData {
    repository?: Record<string, RepositoryEntry>;
    [key: string]: unknown;
}

/**
 * Expands shorthand syntax in tmLanguage data: if a repository entry has both
 * a `name` and `patterns`, child patterns without a `name` inherit the parent's.
 * Returns a new object (does not mutate the input).
 */
export function expandRepository(data: TmLanguageData): TmLanguageData {
    if (data.repository === undefined) {
        return data;
    }

    const expandedRepo: Record<string, RepositoryEntry> = {};
    for (const [key, entry] of Object.entries(data.repository)) {
        if (entry.name !== undefined && entry.patterns !== undefined) {
            const expandedPatterns = entry.patterns.map((item) => {
                if (item.name !== undefined) {
                    return item;
                }
                return { ...item, name: entry.name };
            });
            expandedRepo[key] = { ...entry, patterns: expandedPatterns };
        } else {
            expandedRepo[key] = entry;
        }
    }

    return { ...data, repository: expandedRepo };
}

// -- CLI entry point (tested via subprocess in yaml2json-cli.test.ts) --

/* v8 ignore start -- CLI wrapper tested via execSync integration tests */
function main(): void {
    const inputFile = process.argv[2];
    const outputFile = process.argv[3];

    if (inputFile === undefined || outputFile === undefined) {
        console.error("Usage: yaml2json <input.yml> <output.json>");
        process.exit(1);
    }

    const content = fs.readFileSync(inputFile, "utf8");
    const data = YAML.parse(content) as TmLanguageData;
    const expanded = expandRepository(data);
    fs.writeFileSync(outputFile, JSON.stringify(expanded, null, 2), "utf8");
}

const isDirectRun = process.argv[1]?.endsWith("yaml2json.ts");
if (isDirectRun) {
    main();
}
/* v8 ignore stop */
