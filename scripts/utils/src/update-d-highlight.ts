/**
 * Updates weidu-d.tmLanguage.yml highlight stanzas (actions, chain epilogue,
 * keywords/sugar, state, trans features, trans next, transition, when)
 * from server/data/weidu-d-base.yml.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/update-d-highlight.ts \
 *     --yaml server/data/weidu-d-base.yml \
 *     --highlight syntaxes/weidu-d.tmLanguage.yml
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { type Document } from "yaml";
import { loadData } from "./generate-data.ts";
import { type StanzaConfig, buildHighlightPatterns, updateHighlightStanza } from "./update-tp2-highlight.ts";
import { YAML_DUMP_OPTIONS, parseYamlDocStrict } from "./yaml-helpers.ts";

/** Stanza-to-TextMate mapping: YAML data stanza name -> TextMate repository key. */
const STANZA_MAP: ReadonlyMap<string, StanzaConfig> = new Map([
    ["actions", { repoKey: "d-action" }],
    ["chain_epilogue", { repoKey: "chain-epilogue" }],
    ["keywords", { repoKey: "sugar" }],
    ["state", { repoKey: "state" }],
    ["trans_feature", { repoKey: "transfeature" }],
    ["trans_next", { repoKey: "transnext" }],
    ["transition", { repoKey: "transition" }],
    ["when", { repoKey: "action-when" }],
]);

export function updateDHighlight(yamlPath: string, highlightPath: string): void {
    const data = loadData([yamlPath]);
    const content = fs.readFileSync(highlightPath, "utf8");
    const doc = parseYamlDocStrict(content) as Document;

    const sourceFile = path.basename(yamlPath);
    for (const [stanzaName, config] of STANZA_MAP) {
        const patterns = buildHighlightPatterns(data, stanzaName);
        updateHighlightStanza(doc, config.repoKey, patterns, sourceFile);
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
        console.error("Usage: update-d-highlight --yaml <base.yml> --highlight <tmLanguage.yml>");
        process.exit(1);
    }

    updateDHighlight(yamlPath, highlightPath);
}

const isDirectRun = process.argv[1]?.endsWith("update-d-highlight.ts");
if (isDirectRun) {
    main();
}
/* v8 ignore stop */
