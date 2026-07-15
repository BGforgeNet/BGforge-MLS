/**
 * Updates weidu-baf.tmLanguage.yml highlight stanzas from server data:
 *  - actions/triggers from server/data/weidu-baf-iesdp.yml
 *  - the IDS constant stanzas (animate-ids, ea-ids, race-ids, ...) from server/data/weidu-baf-ids.yml,
 *    so highlighting and completion share ONE source and cannot drift (both read weidu-baf-ids.yml).
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/update-baf-highlight.ts \
 *     --yaml server/data/weidu-baf-iesdp.yml \
 *     --ids-yaml server/data/weidu-baf-ids.yml \
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

/**
 * Maps a weidu-baf-ids.yml stanza key to its tmLanguage repository key: `bgee_animate_ids` -> `animate-ids`.
 * The generated stanzas are named after the IDS file (baf-ids-update.ts IDS_FILES), and the grammar's IDS
 * repository keys follow the `<name>-ids` convention, so the transform is mechanical. A grammar stanza that
 * does not yet exist makes updateHighlightStanza throw - the loud signal to add it (or reconcile the naming).
 */
export function idsStanzaRepoKey(dataKey: string): string {
    return dataKey.replace(/^bgee_/, "").replaceAll("_", "-");
}

/**
 * @param idsYamlPath When provided, the IDS constant stanzas are regenerated from it too. Omitted by the
 *   actions/triggers-only unit tests, which use a fixture without the IDS stanzas.
 */
export function updateBafHighlight(yamlPath: string, highlightPath: string, idsYamlPath?: string): void {
    const content = fs.readFileSync(highlightPath, "utf8");
    const doc: Document = parseYamlDocStrict(content);

    const iesdpData = loadData([yamlPath]);
    const iesdpSource = path.basename(yamlPath);
    for (const stanza of STANZAS) {
        const patterns = buildHighlightPatterns(iesdpData, stanza);
        updateHighlightStanza(doc, stanza, patterns, iesdpSource);
    }

    if (idsYamlPath !== undefined) {
        const idsData = loadData([idsYamlPath]);
        const idsSource = path.basename(idsYamlPath);
        for (const dataKey of Object.keys(idsData)) {
            const patterns = buildHighlightPatterns(idsData, dataKey);
            updateHighlightStanza(doc, idsStanzaRepoKey(dataKey), patterns, idsSource);
        }
    }

    fs.writeFileSync(highlightPath, doc.toString(YAML_DUMP_OPTIONS), "utf8");
}

/* v8 ignore start -- CLI wrapper tested via integration tests */
function main(): void {
    const { values } = parseArgs({
        options: {
            yaml: { type: "string" },
            "ids-yaml": { type: "string" },
            highlight: { type: "string" },
        },
        strict: true,
    });

    const yamlPath = values.yaml;
    const highlightPath = values.highlight;
    if (yamlPath === undefined || highlightPath === undefined) {
        console.error(
            "Usage: update-baf-highlight --yaml <iesdp.yml> [--ids-yaml <ids.yml>] --highlight <tmLanguage.yml>",
        );
        process.exit(1);
    }

    updateBafHighlight(yamlPath, highlightPath, values["ids-yaml"]);
}

const isDirectRun = process.argv[1]?.endsWith("update-baf-highlight.ts");
if (isDirectRun) {
    main();
}
/* v8 ignore stop */
