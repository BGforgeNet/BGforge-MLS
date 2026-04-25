/**
 * Common functions for dumping IElib/IESDP data to completion and highlight YAML files.
 * Handles YAML round-trip read/write (preserving comments), file discovery,
 * completion validation, and definition file generation.
 *
 * Shared helpers (cmpStr, litscal, findFiles, makeBlockScalar, YAML_DUMP_OPTIONS)
 * are in utils/yaml-helpers.
 */

import fs from "node:fs";
import path from "node:path";
import YAML, { Document, YAMLMap, YAMLSeq, isMap, isScalar } from "yaml";
import { cmpStr, findFiles, litscal, makeBlockScalar, YAML_DUMP_OPTIONS } from "../../../utils/src/yaml-helpers.ts";
import { type CompletionItem, type IEData, COMPLETION_TYPE_CONSTANT } from "./types.ts";

export { cmpStr, findFiles, litscal };

const HTML_ENTITY_MAP: Readonly<Record<string, string>> = {
    nbsp: " ",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    amp: "&",
    mdash: "-",
    ndash: "-",
    frasl: "/",
    longrightarrow: "->",
    bull: "*",
    middot: "*",
    hellip: "...",
    lsquo: "'",
    rsquo: "'",
    ldquo: '"',
    rdquo: '"',
};

export interface NormalizeHtmlFragmentOptions {
    readonly resolveHref: (href: string) => string;
    readonly preprocess?: (html: string) => string;
    readonly compactBlankLines?: boolean;
}

/**
 * Sorts strings alphabetically but with longer strings first when one is a
 * prefix of the other. Matches Python's sort_longer_first: compares char by
 * char, then uses length as tiebreaker for prefix matches.
 */
function sortLongerFirst(a: string, b: string): number {
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
        // Safe: i < minLen guarantees both a[i] and b[i] exist
        if (a[i]! < b[i]!) return -1;
        if (a[i]! > b[i]!) return 1;
    }
    // One is a prefix of the other — longer string first
    if (a.length > b.length) return -1;
    if (b.length > a.length) return 1;
    return 0;
}

/**
 * Creates a YAML sequence node for completion items.
 * When forceBlockDoc is true, all doc fields use |- block scalar style
 * (matching Python's LiteralScalarString for action/function docs).
 * When false, only multiline doc values get block style (for offset docs).
 */
export function createItemsSeq(doc: Document, items: readonly CompletionItem[], forceBlockDoc = false): YAMLSeq {
    const seq = new YAMLSeq();
    for (const item of items) {
        const map = new YAMLMap();
        map.add(doc.createPair("name", item.name));
        map.add(doc.createPair("detail", item.detail));
        // Strip trailing whitespace from each line of the doc
        const cleanDoc = item.doc.replace(/ +$/gm, "");
        const docValue = forceBlockDoc || cleanDoc.includes("\n") ? makeBlockScalar(doc, cleanDoc) : cleanDoc;
        map.add(doc.createPair("doc", docValue));
        if (item.type !== undefined) {
            map.add(doc.createPair("type", item.type));
        }
        seq.add(map);
    }
    return seq;
}

/**
 * Dumps IE data into a completion YAML file.
 * Clears all existing stanzas and writes fresh data to avoid leftover stanzas
 * from previous code versions with different naming conventions.
 */
export function dumpCompletion(fpath: string, iedata: IEData): void {
    const doc = new Document();

    for (const [, ied] of Object.entries(iedata)) {
        const stanza = ied.stanza;
        const ctype = ied.completion_type ?? COMPLETION_TYPE_CONSTANT;

        const stanzaMap = new YAMLMap();
        stanzaMap.add(doc.createPair("type", ctype));

        const sortedItems = [...ied.items].sort((a, b) => cmpStr(a.name, b.name));
        const itemsSeq = createItemsSeq(doc, sortedItems, ied.blockDoc === true);
        stanzaMap.add(doc.createPair("items", itemsSeq));

        if (!isMap(doc.contents)) {
            doc.contents = new YAMLMap();
        }
        if (!isMap(doc.contents)) {
            throw new Error("Failed to initialize document contents as YAMLMap");
        }
        doc.contents.add(doc.createPair(stanza, stanzaMap));
    }

    checkCompletion(doc);

    const output = doc.toString(YAML_DUMP_OPTIONS);
    fs.writeFileSync(fpath, output, "utf8");
}

/**
 * Validates that no completion item names are duplicated across stanzas.
 * Allows specific known duplicates (e.g. EVALUATE_BUFFER).
 */
export function checkCompletion(doc: Document): void {
    const items: string[] = [];
    const allowDupes = ["EVALUATE_BUFFER"];

    if (isMap(doc.contents)) {
        for (const pair of doc.contents.items) {
            const stanzaNode = pair.value;
            if (!isMap(stanzaNode)) {
                continue;
            }
            const itemsNode = stanzaNode.get("items", true);
            if (itemsNode instanceof YAMLSeq) {
                for (const item of itemsNode.items) {
                    if (isMap(item)) {
                        const nameNode = item.get("name", true);
                        if (isScalar(nameNode) && typeof nameNode.value === "string") {
                            items.push(nameNode.value);
                        }
                    }
                }
            }
        }
    }

    const counts = new Map<string, number>();
    for (const name of items) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const uniqueDupes = [...counts.entries()]
        .filter(([name, count]) => count > 1 && !allowDupes.includes(name))
        .map(([name]) => name);

    if (uniqueDupes.length > 0) {
        throw new Error(`Duplicated completion items found: ${JSON.stringify(uniqueDupes)}`);
    }
}

/**
 * Dumps IE data into a syntax highlight YAML file (round-trip preserving structure).
 * Updates repository stanzas with match patterns for each item.
 */
export function dumpHighlight(fpath: string, iedata: IEData): void {
    const content = fs.readFileSync(fpath, "utf8");
    const doc = YAML.parseDocument(content);

    const repository = doc.getIn(["repository"], true);
    if (!isMap(repository)) {
        throw new Error(`Expected 'repository' map in ${fpath}`);
    }

    for (const [, ied] of Object.entries(iedata)) {
        const stanza = ied.highlightStanza ?? ied.stanza;

        if (!repository.has(stanza)) {
            const stanzaMap = new YAMLMap();
            stanzaMap.add(doc.createPair("name", ied.scope));
            repository.add(doc.createPair(stanza, stanzaMap));
        }

        const stanzaNode = repository.get(stanza, true);
        if (isMap(stanzaNode)) {
            stanzaNode.set("name", ied.scope);
        }

        const isStringCategory = ied.string === true;

        const itemNames = ied.items.map((x) => x.name);
        const sortedNames = [...itemNames].sort(sortLongerFirst);

        const wordPatterns = sortedNames.map((name) => ({ match: `\\b(${name})\\b` }));
        const patternsSeq = doc.createNode(
            isStringCategory ? [...sortedNames.map((n) => ({ match: `(%${n}%)` })), ...wordPatterns] : wordPatterns,
        );

        if (isMap(stanzaNode)) {
            stanzaNode.set("patterns", patternsSeq);
        }
    }

    const output = doc.toString(YAML_DUMP_OPTIONS);
    fs.writeFileSync(fpath, output, "utf8");
}

/**
 * Writes definition constants to a TPP file in the IElib structures directory.
 * Creates the output directory if it doesn't exist.
 *
 * @param prefix - File format prefix (e.g. "EFF_V2_"), used to derive directory name
 * @param items - Map of constant name to hex value
 * @param structuresDir - Path to ielib/structures
 */
export function dumpDefinition(prefix: string, items: Map<string, string>, structuresDir: string): void {
    const outputDir = path.join(structuresDir, prefix.toLowerCase().replaceAll("_", ""));
    const outputFile = path.join(outputDir, "iesdp.tpp");
    fs.mkdirSync(outputDir, { recursive: true });

    const sortedEntries = [...items.entries()].sort(([a], [b]) => cmpStr(a, b));
    const text = sortedEntries.map(([name, value]) => `${name} = ${value}`).join("\n") + "\n";
    fs.writeFileSync(outputFile, text + "\n", "utf8");
}

/**
 * Removes Jekyll/Liquid template tags from text.
 */
export function stripLiquid(text: string): string {
    return text
        .replace(/{% capture note %}/g, "")
        .replace(/{% endcapture %} {% include note\.html %}/g, "")
        .replace(/{% endcapture %} {% include info\.html %}/g, "");
}

/**
 * Converts a narrow, importer-specific HTML fragment into markdown/plain text.
 * This is intentionally not a general HTML renderer; callers provide href resolution
 * and any source-specific preprocessing.
 */
export function normalizeHtmlFragment(html: string, options: NormalizeHtmlFragmentOptions): string {
    let result = options.preprocess?.(html) ?? html;

    result = result.replace(/<a\s+href="([^"]*)">([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
        const text = htmlInlineToText(inner);
        return `[${text}](${options.resolveHref(href.trim())})`;
    });

    result = result.replace(/<code>(\[[\s\S]*?\]\([\s\S]*?\))<\/code>/gi, "$1");
    result = result.replace(
        /<code>([\s\S]*?)<\/code>/gi,
        (_m, inner: string) => `\`${decodeHtmlEntities(inner.trim())}\``,
    );
    result = result.replace(/<br\s*\/?>/gi, "\n");
    result = result.replace(/<\/?(?:div|p|span|strong|em)>/gi, "");
    result = result.replace(/<sup>([\s\S]*?)<\/sup>/gi, (_m, inner: string) => decodeHtmlEntities(inner));
    // Strip well-formed tags first, then any residual `<`/`>` left by nested
    // or malformed input — single greedy passes leave residue otherwise
    // (CodeQL js/incomplete-multi-character-sanitization).
    result = result.replace(/<[^>]*>/g, "");
    result = result.replace(/[<>]/g, "");
    result = decodeHtmlEntities(result);
    result = result.replace(/[ \t]+\n/g, "\n");

    if (options.compactBlankLines !== false) {
        return normalizeMarkdownWhitespace(result);
    }

    return result.trim();
}

function normalizeMarkdownWhitespace(text: string): string {
    const segments = text.replace(/\n{3,}/g, "\n\n").split(/(```[\s\S]*?```)/g);
    const normalized = segments.map((segment) => {
        if (segment.startsWith("```") && segment.endsWith("```")) {
            return normalizeCodeFence(segment);
        }
        return normalizeProse(segment);
    });

    return normalized.join("").trim();
}

function normalizeProse(text: string): string {
    const lines = text.split("\n").map((line) => line.trim());
    return lines.join("\n").replace(/\n\s*\n+/g, "\n");
}

function normalizeCodeFence(text: string): string {
    return text
        .split("\n")
        .map((line, index, lines) => {
            if (index === 0 || index === lines.length - 1) {
                return line.trim();
            }
            return line.replace(/[ \t]+$/g, "");
        })
        .join("\n");
}

export function htmlInlineToText(html: string): string {
    // Two-step strip: well-formed tags then any residual `<`/`>` from nested
    // or malformed input (CodeQL js/incomplete-multi-character-sanitization).
    const stripped = html.replace(/<[^>]*>/g, "").replace(/[<>]/g, "");
    return decodeHtmlEntities(stripped.trim());
}

export function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#([0-9]+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&([a-zA-Z]+);/g, (match, name: string) => HTML_ENTITY_MAP[name] ?? match);
}
