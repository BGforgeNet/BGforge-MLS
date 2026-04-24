/**
 * IESDP trigger processing for BAF scripting.
 * Extracts trigger signatures and documentation from IESDP trigger HTML pages.
 */

import { normalizeHtmlFragment } from "./common.ts";
import type { CompletionItem } from "./types.ts";

const TRIGGER_HEADER_RE =
    /<strong(?:\s+id="[^"]*")?>\s*(0x[0-9A-F]+)\s+([^<]+?)\s*<\/strong>\s*<br\s*\/?>|<div\s+class="triggerHeader">\s*<a(?:\s+name="[^"]*")?(?:\s+id="[^"]*")?[^>]*>\s*(0x[0-9A-F]+)\s+([^<]+?)\s*<\/a>\s*<\/div>/gi;

/**
 * Extract trigger completion items from an IESDP trigger HTML page.
 *
 * Rationale: this extractor normalizes a small, source-specific subset of IESDP HTML/Jekyll
 * markup into markdown/plain text. We only need stable handling for known constructs such as
 * headers, links, inline code, superscripts, line breaks, Liquid relurl hrefs, and a limited
 * set of entities. A full HTML parser would be more general, but also heavier than needed for
 * this constrained import step. If IESDP starts relying on richer markup, replace the current
 * targeted transforms with fragment parsing plus explicit node-to-markdown rendering.
 */
export function extractTriggersFromHtml(html: string, pageUrl: string): CompletionItem[] {
    const matches = [...html.matchAll(TRIGGER_HEADER_RE)];
    const items: CompletionItem[] = [];

    for (let i = 0; i < matches.length; i++) {
        const group: { name: string; detail: string }[] = [];
        let bodyEnd = html.length;
        let doc = "";

        for (let j = i; j < matches.length; j++) {
            const match = matches[j]!;
            const next = matches[j + 1];
            const fullHeader = (match[2] ?? match[4])?.trim();
            if (!fullHeader) {
                continue;
            }

            const nameMatch = /^([^(]+)\(/.exec(fullHeader);
            if (!nameMatch?.[1]) {
                continue;
            }
            const name = nameMatch[1].trim();
            if (/^reserved\d*$/i.test(name)) {
                continue;
            }
            group.push({ name, detail: fullHeader });

            const bodyStart = match.index! + match[0].length;
            bodyEnd = next?.index ?? html.length;
            doc = htmlToMarkdown(html.slice(bodyStart, bodyEnd), pageUrl);
            if (doc) {
                i = j;
                break;
            }
        }

        if (!doc || group.length === 0) {
            continue;
        }

        for (const entry of group) {
            items.push({
                name: entry.name,
                detail: entry.detail,
                doc,
            });
        }
    }

    return items;
}

function htmlToMarkdown(html: string, pageUrl: string): string {
    return normalizeHtmlFragment(html, {
        preprocess: normalizeLiquidMarkup,
        resolveHref: (href) => resolveUrl(pageUrl, normalizeLiquidHref(href)),
    });
}

function resolveUrl(base: string, relative: string): string {
    if (/^https?:\/\//.test(relative)) {
        return relative;
    }
    if (relative.startsWith("/")) {
        const baseUrl = new URL(base);
        return `${baseUrl.origin}/iesdp${relative}`;
    }
    return new URL(relative, base).toString();
}

function normalizeLiquidHref(href: string): string {
    const match = href.match(/\{\{\s*'([^']+)'\s*\|\s*prepend:\s*relurl\s*\}\}/);
    if (match?.[1]) {
        return match[1];
    }
    return href;
}

function normalizeLiquidMarkup(html: string): string {
    return html
        .replace(/{% capture note %}/g, "")
        .replace(/{% capture info %}/g, "")
        .replace(/{% endcapture %}\s*{% include note\.html %}/g, "")
        .replace(/{% endcapture %}\s*{% include info\.html %}/g, "")
        .replace(/{% endcapture %}\s*{% include bug\.html %}/g, "")
        .replace(/{% include relurl\.html %}/g, "");
}
