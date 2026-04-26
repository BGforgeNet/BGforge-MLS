/**
 * Updates syntaxes/fallout-ssl.tmLanguage.yml's sfall_functions and hooks stanzas
 * from server/data/fallout-ssl-sfall.yml.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/update-sfall-highlight.ts \
 *     --yaml server/data/fallout-ssl-sfall.yml \
 *     --highlight syntaxes/fallout-ssl.tmLanguage.yml
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import YAML, { type Document } from "yaml";
import { HIGHLIGHT_STANZAS } from "../../fallout-update/src/fallout/types.ts";
import { updateHighlightStanza } from "./update-tp2-highlight.ts";
import { type HighlightPattern, YAML_DUMP_OPTIONS, cmpStr, parseYamlDocStrict } from "./yaml-helpers.ts";

interface SfallYaml {
    sfall_functions?: { items?: Array<{ name: string }> };
    hooks?: { items?: Array<{ name: string }> };
}

export function buildSfallFunctionPatterns(yamlPath: string): readonly HighlightPattern[] {
    const raw = YAML.parse(fs.readFileSync(yamlPath, "utf8")) as SfallYaml;
    const items = raw.sfall_functions?.items ?? [];
    return [...items]
        .filter(({ name }) => /^\w+$/.test(name))
        .sort((a, b) => cmpStr(a.name, b.name))
        .map(({ name }) => ({ match: `\\b(?i)(${name})\\b` }));
}

export function buildHooksPatterns(yamlPath: string): readonly HighlightPattern[] {
    const raw = YAML.parse(fs.readFileSync(yamlPath, "utf8")) as SfallYaml;
    const items = raw.hooks?.items ?? [];
    return [...items]
        .filter(({ name }) => /^\w+$/.test(name))
        .sort((a, b) => cmpStr(a.name, b.name))
        .map(({ name }) => ({ match: `\\b(${name})\\b` }));
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
        console.error("Usage: update-sfall-highlight --yaml <sfall.yml> --highlight <tmLanguage.yml>");
        process.exit(1);
    }

    const sfallPatterns = buildSfallFunctionPatterns(yamlPath);
    const hookPatterns = buildHooksPatterns(yamlPath);
    const sourceFile = path.basename(yamlPath);

    const content = fs.readFileSync(highlightPath, "utf8");
    const doc = parseYamlDocStrict(content) as Document;
    updateHighlightStanza(doc, HIGHLIGHT_STANZAS.sfallFunctions, sfallPatterns, sourceFile);
    updateHighlightStanza(doc, HIGHLIGHT_STANZAS.hooks, hookPatterns, sourceFile);
    fs.writeFileSync(highlightPath, doc.toString(YAML_DUMP_OPTIONS), "utf8");
}

const isDirectRun = process.argv[1]?.endsWith("update-sfall-highlight.ts");
if (isDirectRun) {
    main();
}
