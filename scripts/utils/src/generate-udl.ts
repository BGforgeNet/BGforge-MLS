/**
 * Generates Notepad++ User Defined Language (UDL) XML files from YAML data.
 * Produces one UDL per language with keywords, comments, strings, and folding.
 *
 * XML is built via template literals, not a DOM builder -- the structure is fixed
 * and only data values are interpolated (escaped by escapeXml). Output validity
 * is verified by XSD validation in generate-udl.test.ts.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/generate-udl.ts --out-dir <dir>
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { LANGUAGES, collectKeywords, escapeXml, type LanguageDef } from "./language-defs.ts";

// -- XML generation --

/**
 * Build the Comments keyword line for UDL.
 * Format: "00// 01 02 03/\* 04\*\/"
 * All our languages use line comments and C-style block comments.
 */
function buildCommentsLine(): string {
    // UDL comment encoding: 00=line-open, 01=line-continue, 02=line-close,
    // 03=block-open, 04=block-close
    const lineOpen = "//";
    const blockOpen = "/*";
    const blockClose = "*/";
    return `00${lineOpen} 01 02 03${blockOpen} 04${blockClose}`;
}

/**
 * Build the Delimiters keyword line for UDL.
 * Each delimiter pair uses 3 slots: open, alt-open (empty), close.
 * Delimiter1 = slots 00-02, Delimiter2 = 03-05, ..., Delimiter8 = 21-23.
 */
function buildDelimitersLine(delimiters: readonly (readonly [string, string])[]): string {
    // Sort by opening delimiter length (longest first) so Notepad++
    // matches longer delimiters before shorter ones (e.g. ~~~~~ before ~).
    const sorted = [...delimiters].sort((a, b) => b[0].length - a[0].length);
    const parts: string[] = [];
    for (let i = 0; i < 8; i++) {
        const slotBase = i * 3;
        if (i < sorted.length) {
            // Bounds-checked above: i < sorted.length
            const [open, close] = sorted[i]!;
            parts.push(
                `${String(slotBase).padStart(2, "0")}${escapeXml(open)}`,
                `${String(slotBase + 1).padStart(2, "0")}`,
                `${String(slotBase + 2).padStart(2, "0")}${escapeXml(close)}`,
            );
        } else {
            parts.push(
                `${String(slotBase).padStart(2, "0")}`,
                `${String(slotBase + 1).padStart(2, "0")}`,
                `${String(slotBase + 2).padStart(2, "0")}`,
            );
        }
    }
    return parts.join(" ");
}

/** Generate a complete UDL XML string for one language. */
export function generateUdlXml(lang: LanguageDef): string {
    const { keywords, functions, constants } = collectKeywords(lang.yamlFiles);
    const caseFlag = lang.caseIgnored ? "yes" : "no";

    const foldOpen = lang.foldingPairs.map(([o]: readonly [string, string]) => escapeXml(o)).join(" ");
    const foldClose = lang.foldingPairs.map(([, c]: readonly [string, string]) => escapeXml(c)).join(" ");

    return `<?xml version="1.0" encoding="UTF-8" ?>
<NotepadPlus>
    <UserLang name="${escapeXml(lang.name)}" ext="${escapeXml(lang.ext)}" udlVersion="2.1">
        <Settings>
            <Global caseIgnored="${caseFlag}" allowFoldOfComments="yes" foldCompact="no" forcePureLC="0" decimalSeparator="0" />
            <Prefix Keywords1="no" Keywords2="no" Keywords3="no" Keywords4="no" Keywords5="no" Keywords6="no" Keywords7="no" Keywords8="no" />
        </Settings>
        <KeywordLists>
            <Keywords name="Comments">${buildCommentsLine()}</Keywords>
            <Keywords name="Numbers, prefix1"></Keywords>
            <Keywords name="Numbers, prefix2">0x 0X</Keywords>
            <Keywords name="Numbers, extras1"></Keywords>
            <Keywords name="Numbers, extras2"></Keywords>
            <Keywords name="Numbers, suffix1"></Keywords>
            <Keywords name="Numbers, suffix2"></Keywords>
            <Keywords name="Numbers, range"></Keywords>
            <Keywords name="Operators1">- ! % &amp; ( ) * + , . / : ; &lt; = &gt; ? [ ] ^ | ~</Keywords>
            <Keywords name="Operators2"></Keywords>
            <Keywords name="Folders in code1, open">${foldOpen}</Keywords>
            <Keywords name="Folders in code1, middle"></Keywords>
            <Keywords name="Folders in code1, close">${foldClose}</Keywords>
            <Keywords name="Folders in code2, open"></Keywords>
            <Keywords name="Folders in code2, middle"></Keywords>
            <Keywords name="Folders in code2, close"></Keywords>
            <Keywords name="Folders in comment, open"></Keywords>
            <Keywords name="Folders in comment, middle"></Keywords>
            <Keywords name="Folders in comment, close"></Keywords>
            <Keywords name="Keywords1">${keywords.join(" ")}</Keywords>
            <Keywords name="Keywords2">${functions.join(" ")}</Keywords>
            <Keywords name="Keywords3">${constants.join(" ")}</Keywords>
            <Keywords name="Keywords4"></Keywords>
            <Keywords name="Keywords5"></Keywords>
            <Keywords name="Keywords6"></Keywords>
            <Keywords name="Keywords7"></Keywords>
            <Keywords name="Keywords8"></Keywords>
            <Keywords name="Delimiters">${buildDelimitersLine(lang.stringDelimiters)}</Keywords>
        </KeywordLists>
        <Styles>
            <WordsStyle name="DEFAULT" fgColor="000000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="COMMENTS" fgColor="008000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="LINE COMMENTS" fgColor="008000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="NUMBERS" fgColor="FF8000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="KEYWORDS1" fgColor="0000FF" bgColor="FFFFFF" fontStyle="1" nesting="0" />
            <WordsStyle name="KEYWORDS2" fgColor="800080" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="KEYWORDS3" fgColor="FF8000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="KEYWORDS4" fgColor="000000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="KEYWORDS5" fgColor="000000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="KEYWORDS6" fgColor="000000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="KEYWORDS7" fgColor="000000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="KEYWORDS8" fgColor="000000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="OPERATORS" fgColor="000080" bgColor="FFFFFF" fontStyle="1" nesting="0" />
            <WordsStyle name="FOLDER IN CODE1" fgColor="000000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="FOLDER IN CODE2" fgColor="000000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="FOLDER IN COMMENT" fgColor="000000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="DELIMITERS1" fgColor="808080" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="DELIMITERS2" fgColor="808080" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="DELIMITERS3" fgColor="808080" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="DELIMITERS4" fgColor="000000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="DELIMITERS5" fgColor="000000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="DELIMITERS6" fgColor="000000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="DELIMITERS7" fgColor="000000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
            <WordsStyle name="DELIMITERS8" fgColor="000000" bgColor="FFFFFF" fontStyle="0" nesting="0" />
        </Styles>
    </UserLang>
</NotepadPlus>
`;
}

// -- CLI entry point --

/* v8 ignore start -- CLI wrapper */
function main(): void {
    const { values } = parseArgs({
        options: {
            "out-dir": { type: "string" },
        },
        strict: true,
    });

    const outDir = values["out-dir"];
    if (outDir === undefined) {
        console.error("Usage: generate-udl --out-dir <dir>");
        process.exit(1);
    }

    fs.mkdirSync(outDir, { recursive: true });

    for (const lang of LANGUAGES) {
        const xml = generateUdlXml(lang);
        const outPath = path.join(outDir, `${lang.name}.udl.xml`);
        fs.writeFileSync(outPath, xml, "utf8");
        console.log(`Created ${outPath}`);
    }
}

const isDirectRun = process.argv[1]?.endsWith("generate-udl.ts");
if (isDirectRun) {
    main();
}
/* v8 ignore stop */
