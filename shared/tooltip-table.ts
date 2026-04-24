/**
 * Shared table rendering for tooltip markdown.
 * Produces identical output for both built-in (YAML via generate-data.ts)
 * and JSDoc-parsed tooltip paths.
 */

import { formatTypeLink } from "./weidu-types.ts";

export interface VarRow {
    readonly type: string;
    readonly name: string;
    readonly default?: string;
    readonly required?: boolean;
    readonly description?: string;
}

export interface VarSection {
    readonly label: string;
    readonly rows: readonly VarRow[];
}

/** Build a single WeiDU 4-column parameter table. */
export function buildWeiduTable(sections: readonly VarSection[]): string {
    const nonEmpty = sections.filter((section) => section.rows.length > 0);
    if (nonEmpty.length === 0) {
        return "";
    }

    const rows: string[] = ["| | | | |", "|-:|:-|:-|:-|"];

    for (const section of nonEmpty) {
        const [word1, word2] = section.label.split(" ");
        rows.push(`|**${word1}**|**${word2}**|||`);

        for (const row of section.rows) {
            const type = formatTypeLink(row.type);
            const defCell = formatDefault(row);
            const descCell = row.description ? `&nbsp;&nbsp;${row.description}` : "";
            rows.push(`|${type}|${row.name}|${defCell}|${descCell}|`);
        }
    }

    return rows.join("\n");
}

function formatDefault(row: VarRow): string {
    if (row.required) {
        return "_required_";
    }
    if (row.default !== undefined) {
        return `=&nbsp;${row.default}`;
    }
    return "";
}

/** Build the Fallout-style two-column args table. */
export function buildFalloutArgsTable(
    args: readonly { readonly name: string; readonly description?: string }[],
): string {
    const described = args.filter((arg) => arg.description);
    if (described.length === 0) {
        return "";
    }

    const rows: string[] = ["|||", "|:-|:-|"];

    for (const arg of described) {
        rows.push(`|\`${arg.name}\`|&nbsp;&nbsp;${arg.description}|`);
    }

    return rows.join("\n");
}
