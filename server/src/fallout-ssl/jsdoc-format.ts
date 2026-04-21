/**
 * Fallout SSL JSDoc-to-markdown formatting utilities.
 * Converts parsed JSDoc objects to markdown for hover tooltips and completion items.
 */

import type { JSdoc } from "../shared/jsdoc";
import { buildFalloutArgsTable } from "../../../shared/tooltip-table";
import { formatDeprecation } from "../../../shared/tooltip-format";

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
