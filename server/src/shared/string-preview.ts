/**
 * How a game string is previewed in the editor: the inlay label beside a reference, its tooltip, and the hover.
 *
 * Shared so that every kind of string reference looks the same wherever it appears - a `.tra`/`.msg` entry
 * behind `@100` and a TLK strref behind `DisplayString(Myself,46150)` are the same thing to a reader, and a
 * change to how one is shown must not leave the other behind.
 */

import { MarkupKind, type Hover, type MarkupContent } from "vscode-languageserver/node";

/** Inlay labels sit inline with code, so a long string is cut and the full text moved to the tooltip. */
const MAX_INLAY_LENGTH = 30;

/** The fenced language the client's grammar highlights string previews with. */
const PREVIEW_FENCE = "bgforge-mls-string";

export interface StringPreview {
    /** The string in full, as markdown. Backs both the hover and a truncated inlay's tooltip. */
    readonly markup: MarkupContent;
    /** Markdown hover showing the string in full. */
    readonly hover: Hover;
    /** The inlay label, already wrapped in comment markers and shortened if needed. */
    readonly inlay: string;
    /** Present only when `inlay` is not the whole string, so the tooltip has something to add. */
    readonly inlayTooltip?: string;
}

function toInlay(text: string): string {
    let line = text.replaceAll("\r", "");
    line = line.replaceAll("\n", "\\n");
    // Escape */ to prevent breaking the inlay comment syntax
    line = line.replaceAll("*/", "*\\/");
    if (line.length > MAX_INLAY_LENGTH) {
        line = line.slice(0, MAX_INLAY_LENGTH - 3) + "...";
    }
    return `/* ${line} */`;
}

export function stringPreview(text: string): StringPreview {
    const inlay = toInlay(text);
    const markup: MarkupContent = {
        kind: MarkupKind.Markdown,
        value: `\`\`\`${PREVIEW_FENCE}\n${text}\n\`\`\``,
    };
    const base = { markup, hover: { contents: markup } };
    // Equal means the label already shows the whole string; a tooltip would just repeat it.
    return `/* ${text} */` === inlay ? { ...base, inlay } : { ...base, inlay, inlayTooltip: text };
}
