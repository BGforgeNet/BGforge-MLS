/**
 * Fallout SSL JSDoc-to-markdown formatting utilities.
 * Converts parsed JSDoc objects to markdown for hover tooltips and completion items,
 * and assembles the tooltip base shared by procedures and macros.
 */

import type { JSdoc } from "../shared/jsdoc";
import { buildFalloutArgsTable } from "../../../shared/tooltip-table";
import { buildSignatureBlock, formatDeprecation } from "../../../shared/tooltip-format";
import { LANG_FALLOUT_SSL_TOOLTIP } from "../core/languages";

/**
 * Convert JSDoc to markdown documentation (Fallout SSL format).
 * Produces a headerless 2-column table for args and a Returns line.
 */
export function jsdocToMarkdown(jsd: JSdoc): string {
    let md = "\n---\n";

    if (jsd.desc) {
        md += `\n${jsd.desc}`;
    }

    const argsTable = buildFalloutArgsTable(jsd.args);
    if (argsTable) {
        md += "\n\n" + argsTable;
    }

    if (jsd.ret?.description) {
        md += `\n\n**Returns** ${jsd.ret.description}`;
    }

    md += formatDeprecation(jsd.deprecated);

    return md;
}

/**
 * Build base tooltip content: signature block + optional file path + optional JSDoc
 * + optional engine doc (for engine procedures).
 * Shared by procedures and macros.
 * Used by: hover (contents.value), completion (documentation.value), header symbols.
 */
export function buildTooltipBase(
    signature: string,
    jsdocData: JSdoc | null,
    filePath?: string,
    engineDoc?: string,
): string {
    let markdown = buildSignatureBlock(signature, LANG_FALLOUT_SSL_TOOLTIP, filePath);
    if (jsdocData) {
        markdown += jsdocToMarkdown(jsdocData);
    }
    if (engineDoc) {
        if (jsdocData) {
            // Separate engine doc from user JSDoc with a horizontal rule.
            markdown += "\n\n---\n\n";
        } else {
            // No user JSDoc - still need a blank line after the closing code fence.
            markdown += "\n\n";
        }
        markdown += engineDoc;
    }
    return markdown;
}
