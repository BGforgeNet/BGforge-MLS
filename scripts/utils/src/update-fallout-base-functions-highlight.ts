/**
 * Updates syntaxes/fallout-ssl.tmLanguage.yml's fallout-base-functions stanza
 * from active function stanzas in server/data/fallout-ssl-base.yml.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/update-fallout-base-functions-highlight.ts \
 *     --yaml server/data/fallout-ssl-base.yml \
 *     --highlight syntaxes/fallout-ssl.tmLanguage.yml
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import YAML, { type Document } from "yaml";
import { HIGHLIGHT_STANZAS } from "../../fallout-update/src/fallout/types.ts";
import { FALLOUT_SSL_BUILTIN_FUNCTION_STANZAS } from "../../../shared/stanza-names.ts";
import { loadData } from "./generate-data.ts";
import { updateHighlightStanza } from "./update-tp2-highlight.ts";
import { type HighlightPattern, YAML_DUMP_OPTIONS, cmpStr } from "./yaml-helpers.ts";

export function buildFalloutBaseFunctionPatterns(yamlPath: string): readonly HighlightPattern[] {
    const data = loadData([yamlPath]);
    const seen = new Set<string>();
    const patternsByName = new Map<string, HighlightPattern>();

    for (const stanzaName of FALLOUT_SSL_BUILTIN_FUNCTION_STANZAS) {
        const stanza = data[stanzaName];
        if (stanza === undefined) continue;
        for (const item of stanza.items) {
            if (seen.has(item.name)) continue;
            seen.add(item.name);
            patternsByName.set(item.name, {
                match: `\\b(?i)(${item.name})\\b`,
                ...(item.deprecated !== undefined ? { name: "invalid.deprecated.bgforge" } : {}),
            });
        }
    }

    return [...patternsByName.entries()].sort(([a], [b]) => cmpStr(a, b)).map(([, pattern]) => pattern);
}

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
        console.error("Usage: update-fallout-base-functions-highlight --yaml <base.yml> --highlight <tmLanguage.yml>");
        process.exit(1);
    }

    const basePatterns = buildFalloutBaseFunctionPatterns(yamlPath);
    const content = fs.readFileSync(highlightPath, "utf8");
    const doc = YAML.parseDocument(content) as Document;
    const sourceFile = path.basename(yamlPath);
    updateHighlightStanza(doc, HIGHLIGHT_STANZAS.falloutBaseFunctions, basePatterns, sourceFile);
    fs.writeFileSync(highlightPath, doc.toString(YAML_DUMP_OPTIONS), "utf8");
}

const isDirectRun = process.argv[1]?.endsWith("update-fallout-base-functions-highlight.ts");
if (isDirectRun) {
    main();
}
