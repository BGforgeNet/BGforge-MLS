/**
 * Turns located strrefs into the editor surfaces that show what they say: an inlay label beside the number and
 * a hover on it. Language-agnostic - it takes sites and a resolver, so every language whose provider can point
 * at its strrefs gets both features from here.
 */

import { InlayHintKind, type Hover, type InlayHint, type Position, type Range } from "vscode-languageserver/node";
import { stringPreview } from "../shared/string-preview";
import type { StrRefSite } from "./strref-sites";

/** Resolves a strref to its text, or undefined when the configured game cannot answer. */
export type StrRefResolver = (strref: number) => string | undefined;

export function strRefInlayHints(sites: readonly StrRefSite[], resolve: StrRefResolver, range: Range): InlayHint[] {
    const hints: InlayHint[] = [];
    for (const site of sites) {
        const line = site.range.end.line;
        if (line < range.start.line || line > range.end.line) continue;
        const text = resolve(site.strref);
        // An unresolved strref shows no preview: the game may simply not be configured, and an editor full of
        // "missing" markers would say nothing useful. Matches how an unresolved translation reference behaves.
        if (text === undefined) continue;
        const preview = stringPreview(text);
        hints.push({
            position: site.range.end,
            label: preview.inlay,
            ...(preview.inlayTooltip === undefined ? {} : { tooltip: preview.markup }),
            kind: InlayHintKind.Parameter,
            paddingLeft: true,
            paddingRight: true,
        });
    }
    return hints;
}

export function strRefHover(
    sites: readonly StrRefSite[],
    resolve: StrRefResolver,
    position: Position,
): Hover | undefined {
    const site = sites.find((candidate) => covers(candidate.range, position));
    if (!site) return undefined;
    const text = resolve(site.strref);
    return text === undefined ? undefined : stringPreview(text).hover;
}

/** End-inclusive, so the cursor sitting just past the last digit still hovers the number it is touching. */
function covers(range: Range, position: Position): boolean {
    return (
        position.line === range.start.line &&
        position.character >= range.start.character &&
        position.character <= range.end.character
    );
}
