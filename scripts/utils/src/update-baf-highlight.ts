/**
 * Updates weidu-baf.tmLanguage.yml highlight stanzas (actions, triggers)
 * from server/data/weidu-baf-iesdp.yml.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/update-baf-highlight.ts \
 *     --yaml server/data/weidu-baf-iesdp.yml \
 *     --highlight syntaxes/weidu-baf.tmLanguage.yml
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { type Document } from "yaml";
import { loadData } from "./generate-data.ts";
import { buildHighlightPatterns, updateHighlightStanza } from "./update-tp2-highlight.ts";
import { YAML_DUMP_OPTIONS, parseYamlDocStrict } from "./yaml-helpers.ts";

/** Stanzas whose name in the data YAML matches the tmLanguage repository key. */
const STANZAS: readonly string[] = ["actions", "triggers"];

export function updateBafHighlight(yamlPath: string, highlightPath: string): void {
    const data = loadData([yamlPath]);
    const content = fs.readFileSync(highlightPath, "utf8");
    const doc: Document = parseYamlDocStrict(content);

    const sourceFile = path.basename(yamlPath);
    for (const stanza of STANZAS) {
        const patterns = buildHighlightPatterns(data, stanza);
        updateHighlightStanza(doc, stanza, patterns, sourceFile);
    }

    fs.writeFileSync(highlightPath, doc.toString(YAML_DUMP_OPTIONS), "utf8");
}

/* v8 ignore start -- CLI wrapper tested via integration tests */
function main(): void {
    const { values } = parseArgs({
        options: {
            yaml: { type: "string" },
            highlight: { type: "string" },
        },
        strict: true,
    });

    const yamlPath = values.yaml;
    const highlightPath = values.highlight;
    if (yamlPath === undefined || highlightPath === undefined) {
        console.error("Usage: update-baf-highlight --yaml <iesdp.yml> --highlight <tmLanguage.yml>");
        process.exit(1);
    }

    updateBafHighlight(yamlPath, highlightPath);
}

const isDirectRun = process.argv[1]?.endsWith("update-baf-highlight.ts");
if (isDirectRun) {
    main();
}
/* v8 ignore stop */
