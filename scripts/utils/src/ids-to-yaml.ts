/**
 * Converts IDS (Infinity Engine Data Structure) list files to YAML
 * completion data format.
 *
 * Replaces the former ids_to_yaml.py script.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/ids-to-yaml.ts <input.ids> <doc_value> <output.yml>
 */

import fs from "node:fs";
import YAML from "yaml";
import { YAML_DUMP_OPTIONS } from "./yaml-helpers.ts";

interface IdsEntry {
    readonly name: string;
    readonly detail: string;
    readonly doc: string;
}

/**
 * Parses an IDS file into structured entries.
 * Each non-empty line is expected to have format: `<value> <name>`.
 * Lines that don't match this format are skipped.
 */
export function parseIdsFile(content: string, docValue: string): readonly IdsEntry[] {
    const entries: IdsEntry[] = [];
    for (const rawLine of content.split("\n")) {
        const line = rawLine.trim();
        if (line === "") {
            continue;
        }
        const parts = line.split(/\s+/);
        if (parts.length === 2) {
            entries.push({
                name: parts[1]!,
                detail: parts[0]!,
                doc: docValue,
            });
        }
    }
    return entries;
}

// -- CLI entry point (tested via subprocess in ids-to-yaml-cli.test.ts) --

/* v8 ignore start -- CLI wrapper tested via execSync integration tests */
function main(): void {
    const inputFile = process.argv[2];
    const docValue = process.argv[3];
    const outputFile = process.argv[4];

    if (inputFile === undefined || docValue === undefined || outputFile === undefined) {
        console.error("Usage: ids-to-yaml <input.ids> <doc_value> <output.yml>");
        process.exit(1);
    }

    const content = fs.readFileSync(inputFile, "utf8");
    const entries = parseIdsFile(content, docValue);
    const yamlStr = YAML.stringify(entries, null, YAML_DUMP_OPTIONS);
    fs.writeFileSync(outputFile, yamlStr, "utf8");

    console.log(`Output written to ${outputFile}`);
}

const isDirectRun = process.argv[1]?.endsWith("ids-to-yaml.ts");
if (isDirectRun) {
    main();
}
/* v8 ignore stop */
