/**
 * Common helpers for building IElib/IESDP completion YAML nodes and converting
 * IESDP HTML fragments to markdown/plain text.
 *
 * Shared helpers (cmpStr, litscal, findFiles, makeBlockScalar) are in utils/yaml-helpers.
 */

import { type Document, YAMLMap, YAMLSeq } from "yaml";
import { cmpStr, findFiles, litscal, makeBlockScalar } from "../../../utils/src/yaml-helpers.ts";
import { type CompletionItem } from "./types.ts";

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
        const cleanDoc = item.doc.replaceAll(/ +$/gm, "");
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
 * Removes Jekyll/Liquid template tags from text.
 */
export function stripLiquid(text: string): string {
    return text
        .replaceAll("{% capture note %}", "")
        .replaceAll("{% endcapture %} {% include note.html %}", "")
        .replaceAll("{% endcapture %} {% include info.html %}", "");
}

/**
 * Converts a narrow, importer-specific HTML fragment into markdown/plain text.
 * This is intentionally not a general HTML renderer; callers provide href resolution
 * and any source-specific preprocessing.
 */
export function normalizeHtmlFragment(html: string, options: NormalizeHtmlFragmentOptions): string {
    let result = options.preprocess?.(html) ?? html;

    result = result.replaceAll(/<a\s+href="([^"]*)">([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
        const text = htmlInlineToText(inner);
        return `[${text}](${options.resolveHref(href.trim())})`;
    });

    result = result.replaceAll(/<code>(\[[\s\S]*?\]\([\s\S]*?\))<\/code>/gi, "$1");
    result = result.replaceAll(
        /<code>([\s\S]*?)<\/code>/gi,
        (_m, inner: string) => `\`${decodeHtmlEntities(inner.trim())}\``,
    );
    result = result.replaceAll(/<br\s*\/?>/gi, "\n");
    result = result.replaceAll(/<\/?(?:div|p|span|strong|em)>/gi, "");
    result = result.replaceAll(/<sup>([\s\S]*?)<\/sup>/gi, (_m, inner: string) => decodeHtmlEntities(inner));
    // Strip remaining HTML tags. Repeat-until-stable with `[^<>]*` (forbidding
    // both brackets) handles nested tags that a single greedy pass would leave
    // residue from (CodeQL js/incomplete-multi-character-sanitization).
    let prev: string;
    do {
        prev = result;
        result = result.replaceAll(/<[^<>]*>/g, "");
    } while (result !== prev);
    result = decodeHtmlEntities(result);
    result = result.replaceAll(/[ \t]+\n/g, "\n");

    if (options.compactBlankLines !== false) {
        return normalizeMarkdownWhitespace(result);
    }

    return result.trim();
}

function normalizeMarkdownWhitespace(text: string): string {
    const segments = text.replaceAll(/\n{3,}/g, "\n\n").split(/(```[\s\S]*?```)/g);
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
    return lines.join("\n").replaceAll(/\n\s*\n+/g, "\n");
}

function normalizeCodeFence(text: string): string {
    return text
        .split("\n")
        .map((line, index, lines) => {
            if (index === 0 || index === lines.length - 1) {
                return line.trim();
            }
            return line.replaceAll(/[ \t]+$/g, "");
        })
        .join("\n");
}

export function htmlInlineToText(html: string): string {
    // Repeat-until-stable with `[^<>]*` (forbidding both brackets) handles
    // nested tags that a single greedy pass leaves residue from (CodeQL
    // js/incomplete-multi-character-sanitization).
    let stripped = html;
    let prev: string;
    do {
        prev = stripped;
        stripped = stripped.replaceAll(/<[^<>]*>/g, "");
    } while (stripped !== prev);
    return decodeHtmlEntities(stripped.trim());
}

export function decodeHtmlEntities(text: string): string {
    return text
        .replaceAll(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
        .replaceAll(/&#([0-9]+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
        .replaceAll(/&([a-zA-Z]+);/g, (match, name: string) => HTML_ENTITY_MAP[name] ?? match);
}
