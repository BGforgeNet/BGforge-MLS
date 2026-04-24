/**
 * Shared language definitions for syntax highlighting generators (UDL, KSyntaxHighlighting).
 * Contains language metadata and keyword collection from YAML data files.
 */

import { loadData } from "./generate-data.ts";

// -- Types --

export interface LanguageDef {
    /** Machine-readable name (e.g. "fallout-ssl") */
    readonly name: string;
    /** Human-readable display name (e.g. "Fallout SSL") */
    readonly displayName: string;
    /** Space-separated extensions without dots (e.g. "ssl h") */
    readonly ext: string;
    readonly yamlFiles: readonly string[];
    readonly caseIgnored: boolean;
    /** String delimiters: [open, close] pairs */
    readonly stringDelimiters: readonly (readonly [string, string])[];
    /** Code folding open/close pairs */
    readonly foldingPairs: readonly (readonly [string, string])[];
}

// -- YAML data type constants --

export const TYPE_FUNCTION = 3;
export const TYPE_KEYWORD = 14;
export const TYPE_CONSTANT = 21;

// -- Language definitions --

const DATA_DIR = "server/data";

export const LANGUAGES: readonly LanguageDef[] = [
    {
        name: "weidu-tra",
        displayName: "WeiDU TRA",
        ext: "tra",
        yamlFiles: [],
        caseIgnored: false,
        stringDelimiters: [
            ["~", "~"],
            ['"', '"'],
            ["~~~~~", "~~~~~"],
        ],
        foldingPairs: [],
    },
    {
        name: "fallout-ssl",
        displayName: "Fallout SSL",
        ext: "ssl h",
        yamlFiles: [`${DATA_DIR}/fallout-ssl-base.yml`, `${DATA_DIR}/fallout-ssl-sfall.yml`],
        caseIgnored: false,
        stringDelimiters: [['"', '"']],
        foldingPairs: [
            ["begin", "end"],
            ["{", "}"],
        ],
    },
    {
        name: "weidu-baf",
        displayName: "WeiDU BAF",
        ext: "baf",
        yamlFiles: [
            `${DATA_DIR}/weidu-baf-base.yml`,
            `${DATA_DIR}/weidu-baf-iesdp.yml`,
            `${DATA_DIR}/weidu-baf-ids.yml`,
        ],
        caseIgnored: true,
        stringDelimiters: [
            ["~", "~"],
            ['"', '"'],
        ],
        foldingPairs: [["IF", "END"]],
    },
    {
        name: "weidu-d",
        displayName: "WeiDU D",
        ext: "d",
        yamlFiles: [`${DATA_DIR}/weidu-d-base.yml`],
        caseIgnored: true,
        stringDelimiters: [
            ["~", "~"],
            ['"', '"'],
        ],
        foldingPairs: [["BEGIN", "END"]],
    },
    {
        name: "weidu-tp2",
        displayName: "WeiDU TP2",
        ext: "tp2 tpa tph tpp",
        yamlFiles: [`${DATA_DIR}/weidu-tp2-base.yml`],
        caseIgnored: true,
        stringDelimiters: [
            ["~", "~"],
            ['"', '"'],
            ["%", "%"],
        ],
        foldingPairs: [["BEGIN", "END"]],
    },
];

// -- XML helpers --

/**
 * Escape XML special characters in attribute values and text content.
 * Used by generators that build XML via template literals (not DOM/parser).
 * Output validity is verified by XSD validation in tests.
 */
export function escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// -- Keyword collection --

export interface KeywordGroups {
    readonly keywords: readonly string[];
    readonly functions: readonly string[];
    readonly constants: readonly string[];
}

/**
 * Collect unique keyword names from YAML data, grouped by type.
 * Type 14 = keywords, type 3 = functions, type 21 = constants.
 */
export function collectKeywords(yamlFiles: readonly string[]): KeywordGroups {
    const data = loadData(yamlFiles);

    const kw = new Set<string>();
    const fn = new Set<string>();
    const cn = new Set<string>();

    for (const stanza of Object.values(data)) {
        const target =
            stanza.type === TYPE_KEYWORD
                ? kw
                : stanza.type === TYPE_FUNCTION
                  ? fn
                  : stanza.type === TYPE_CONSTANT
                    ? cn
                    : null;
        if (target === null) continue;

        for (const item of stanza.items) {
            target.add(item.name);
        }
    }

    const sorted = (s: Set<string>) => [...s].sort();
    return {
        keywords: sorted(kw),
        functions: sorted(fn),
        constants: sorted(cn),
    };
}
