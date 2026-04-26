/**
 * Updates weidu-tp2.tmLanguage.yml highlight stanzas (actions, patches,
 * flags, options, callables, vars, etc.) from server/data/weidu-tp2-base.yml.
 *
 * Generates sorted \b(NAME)\b patterns from YAML data stanzas, replacing
 * the hand-maintained pattern lists. Non-match entries (include directives)
 * are preserved at the end of each stanza.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/update-tp2-highlight.ts \
 *     --yaml server/data/weidu-tp2-base.yml \
 *     --highlight syntaxes/weidu-tp2.tmLanguage.yml
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { type Document, isMap, isScalar, isSeq } from "yaml";
import { type DataFile, loadData } from "./generate-data.ts";
import { type HighlightPattern, cmpStr, YAML_DUMP_OPTIONS, parseYamlDocStrict } from "./yaml-helpers.ts";

export type { HighlightPattern };

/**
 * Matches identifiers already caught by the upper-case-constants catch-all rule
 * in the TextMate grammar. Items matching this pattern can be skipped from
 * generated stanzas that share the same constant.language scope family.
 */
const UPPER_CASE_CATCHALL = /^[A-Z][A-Z0-9]+_\w+$/;

export interface StanzaConfig {
    readonly repoKey: string;
    /** When true, skip items whose names match the upper-case-constants catch-all. */
    readonly skipCatchall?: boolean;
}

/** Stanza-to-TextMate mapping: YAML data stanza name -> TextMate config. */
const STANZA_MAP: ReadonlyMap<string, StanzaConfig> = new Map([
    ["action", { repoKey: "weidu-tp2-action" }],
    ["array_sort_type", { repoKey: "weidu-tp2-arrarindicessorttype" }],
    ["caching", { repoKey: "weidu-tp2-caching" }],
    ["component_flag", { repoKey: "weidu-tp2-component-flag" }],
    ["flag", { repoKey: "weidu-tp2-flag" }],
    ["language", { repoKey: "weidu-tp2-language" }],
    ["opt_case", { repoKey: "weidu-tp2-optcase" }],
    ["opt_exact", { repoKey: "weidu-tp2-optexact" }],
    ["opt_glob", { repoKey: "weidu-tp2-optglob" }],
    ["patch", { repoKey: "weidu-tp2-patch" }],
    ["patch_byte", { repoKey: "weidu-tp2-patch-byte" }],
    ["patch_long", { repoKey: "weidu-tp2-patch-long" }],
    ["patch_string", { repoKey: "weidu-tp2-patch-string" }],
    ["prologue", { repoKey: "weidu-tp2-file" }],
    ["value_constant", { repoKey: "infinity-constants", skipCatchall: true }],
    ["value_function", { repoKey: "weidu-tp2-values" }],
    // value_operator not generated — TextMate stanza has non-word-boundary operator regexes
    ["when", { repoKey: "weidu-tp2-when" }],
]);

export function buildHighlightPatterns(
    data: DataFile,
    stanzaName: string,
    skipCatchall = false,
): readonly HighlightPattern[] {
    const stanza = data[stanzaName];
    if (stanza === undefined) {
        throw new Error(`Stanza '${stanzaName}' not found`);
    }

    return stanza.items
        .filter((item) => /^\w/.test(item.name))
        .filter((item) => !skipCatchall || !UPPER_CASE_CATCHALL.test(item.name))
        .map(
            (item): HighlightPattern => ({
                match: `\\b(${item.name})\\b`,
                ...(item.deprecated !== undefined ? { name: `invalid.deprecated.bgforge` } : {}),
            }),
        )
        .sort((a, b) => cmpStr(a.match, b.match));
}

/**
 * Replaces match patterns in a TextMate repository stanza, preserving
 * non-match entries (include directives) at the end.
 * When sourceFile is provided, sets an auto-generated comment on the stanza.
 */
export function updateHighlightStanza(
    doc: Document,
    repositoryKey: string,
    patterns: readonly HighlightPattern[],
    sourceFile?: string,
): void {
    const repo = doc.getIn(["repository"], true);
    if (!isMap(repo)) {
        throw new Error("Expected 'repository' map");
    }
    const stanzaPair = repo.items.find((pair) => isScalar(pair.key) && pair.key.value === repositoryKey);
    if (stanzaPair === undefined || !isMap(stanzaPair.value)) {
        throw new Error(`Expected 'repository.${repositoryKey}' map`);
    }
    if (sourceFile !== undefined) {
        stanzaPair.value.commentBefore = ` Auto-generated from ${sourceFile} — do not edit manually.`;
    }
    const stanzaNode = stanzaPair.value;

    const patternsNode = stanzaNode.get("patterns", true);
    if (!isSeq(patternsNode)) {
        throw new Error(`Expected 'patterns' seq in repository.${repositoryKey}`);
    }

    // Collect non-match items (e.g. include directives) to preserve at the end
    const preserved: unknown[] = [];
    for (const item of patternsNode.items) {
        if (!isMap(item)) continue;
        const hasMatch = item.items.some((pair) => isScalar(pair.key) && pair.key.value === "match");
        if (!hasMatch) {
            preserved.push(item.toJSON());
        }
    }

    const allItems = [...patterns, ...preserved];
    const newPatterns = doc.createNode(allItems);
    stanzaNode.set("patterns", newPatterns);
}

/**
 * Callable stanza config: multiple YAML stanzas merged into one TM stanza,
 * with per-type scope names for disambiguation.
 */
interface CallableStanzaEntry {
    readonly yamlKey: string;
    readonly scope: string;
}

const CALLABLE_STANZAS: readonly CallableStanzaEntry[] = [
    { yamlKey: "action_functions", scope: "support.function.weidu-tp2.action-function" },
    { yamlKey: "action_macros", scope: "support.function.weidu-tp2.action-macro" },
    { yamlKey: "dimorphic_functions", scope: "support.function.weidu-tp2.dimorphic-function" },
    { yamlKey: "patch_functions", scope: "support.function.weidu-tp2.patch-function" },
    { yamlKey: "patch_macros", scope: "support.function.weidu-tp2.patch-macro" },
];

const CALLABLE_REPO_KEY = "weidu-tp2-callable";

/**
 * Builds highlight patterns from multiple callable YAML stanzas, deduplicating
 * by name and assigning per-type scope names for disambiguation.
 */
export function buildCallablePatterns(data: DataFile): readonly HighlightPattern[] {
    const seen = new Set<string>();
    const patterns: HighlightPattern[] = [];

    for (const { yamlKey, scope } of CALLABLE_STANZAS) {
        const stanza = data[yamlKey];
        if (stanza === undefined) continue;
        for (const item of stanza.items) {
            if (!/^\w/.test(item.name) || seen.has(item.name)) continue;
            seen.add(item.name);
            patterns.push({
                match: `\\b(${item.name})\\b`,
                name: item.deprecated !== undefined ? "invalid.deprecated.bgforge" : scope,
            });
        }
    }

    return patterns.sort((a, b) => cmpStr(a.match, b.match));
}

const VARS_STANZAS: readonly string[] = ["vars", "constants"];
const VARS_REPO_KEY = "weidu-vars";

/**
 * Builds highlight patterns for the weidu-vars TM stanza. Merges vars and
 * constants YAML stanzas. Uses (%?NAME%?) pattern format (optional %
 * delimiters) instead of the standard \b(NAME)\b word-boundary format.
 */
export function buildVarsPatterns(data: DataFile): readonly HighlightPattern[] {
    const seen = new Set<string>();
    const patterns: HighlightPattern[] = [];

    for (const stanzaName of VARS_STANZAS) {
        const stanza = data[stanzaName];
        if (stanza === undefined) continue;
        for (const item of stanza.items) {
            if (seen.has(item.name)) continue;
            seen.add(item.name);
            patterns.push({
                match: `(%?${item.name}%?)`,
            });
        }
    }

    return patterns.sort((a, b) => cmpStr(a.match, b.match));
}

export function updateTp2Highlight(yamlPath: string, highlightPath: string): void {
    const data = loadData([yamlPath]);
    const content = fs.readFileSync(highlightPath, "utf8");
    const doc: Document = parseYamlDocStrict(content);

    const sourceFile = path.basename(yamlPath);
    for (const [stanzaName, config] of STANZA_MAP) {
        const patterns = buildHighlightPatterns(data, stanzaName, config.skipCatchall);
        updateHighlightStanza(doc, config.repoKey, patterns, sourceFile);
    }

    const callablePatterns = buildCallablePatterns(data);
    updateHighlightStanza(doc, CALLABLE_REPO_KEY, callablePatterns, sourceFile);

    const varsPatterns = buildVarsPatterns(data);
    updateHighlightStanza(doc, VARS_REPO_KEY, varsPatterns, sourceFile);

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
        console.error("Usage: update-tp2-highlight --yaml <base.yml> --highlight <tmLanguage.yml>");
        process.exit(1);
    }

    updateTp2Highlight(yamlPath, highlightPath);
}

const isDirectRun = process.argv[1]?.endsWith("update-tp2-highlight.ts");
if (isDirectRun) {
    main();
}
/* v8 ignore stop */
