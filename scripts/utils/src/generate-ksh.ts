/**
 * Generates KDE KSyntaxHighlighting XML definitions from YAML data.
 * Produces one .xml per language for use in Kate, KWrite, and other KDE editors.
 * Users install by copying to ~/.local/share/org.kde.syntax-highlighting/syntax/
 *
 * XML is built via template literals, not a DOM builder -- the structure is fixed
 * and only data values are interpolated (escaped by escapeXml). Output validity
 * is verified by XSD validation in generate-ksh.test.ts.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/generate-ksh.ts --out-dir <dir>
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { LANGUAGES, collectKeywords, escapeXml, type LanguageDef } from "./language-defs.ts";

/**
 * Convert space-separated extensions to semicolon-separated glob patterns.
 * "ssl h" -> "*.ssl;*.h"
 */
function toExtensionGlobs(ext: string): string {
    return ext
        .split(" ")
        .map((e) => `*.${e}`)
        .join(";");
}

// -- String context generation --

/**
 * Generate context rules for string delimiters.
 * Each delimiter pair gets: a DetectChar/StringDetect rule in Normal context,
 * and a dedicated string context that pops on the closing delimiter.
 */
function buildStringRules(delimiters: readonly (readonly [string, string])[]): {
    readonly normalRules: string;
    readonly contexts: string;
    readonly itemDatas: string;
} {
    const normalLines: string[] = [];
    const contextLines: string[] = [];
    const itemDataLines: string[] = [];

    // Sort by opening delimiter length (longest first) so KSH matches
    // longer delimiters before shorter ones (e.g. ~~~~~ before ~).
    const sorted = [...delimiters].sort((a, b) => b[0].length - a[0].length);

    for (let i = 0; i < sorted.length; i++) {
        // Bounds-checked: i < sorted.length
        const [open, close] = sorted[i]!;
        const idx = i + 1;
        const contextName = `String${idx}`;
        const attrName = `String ${idx}`;

        if (open.length === 1) {
            normalLines.push(
                `        <DetectChar attribute="${attrName}" context="${contextName}" char="${escapeXml(open)}"/>`,
            );
        } else {
            normalLines.push(
                `        <StringDetect attribute="${attrName}" context="${contextName}" String="${escapeXml(open)}"/>`,
            );
        }

        const closeRule =
            close.length === 1
                ? `          <DetectChar attribute="${attrName}" context="#pop" char="${escapeXml(close)}"/>`
                : `          <StringDetect attribute="${attrName}" context="#pop" String="${escapeXml(close)}"/>`;

        contextLines.push(
            `      <context name="${contextName}" attribute="${attrName}" lineEndContext="#stay">`,
            closeRule,
            "      </context>",
        );

        itemDataLines.push(`        <itemData name="${attrName}" defStyleNum="dsString"/>`);
    }

    return {
        normalRules: normalLines.join("\n"),
        contexts: contextLines.join("\n"),
        itemDatas: itemDataLines.join("\n"),
    };
}

// -- Folding region generation --

function buildFoldingRules(pairs: readonly (readonly [string, string])[]): string {
    const lines: string[] = [];
    for (let i = 0; i < pairs.length; i++) {
        // Bounds-checked: i < pairs.length
        const [open, close] = pairs[i]!;
        const region = `fold${i + 1}`;
        lines.push(
            `        <WordDetect attribute="Keyword" context="#stay" String="${escapeXml(open)}" beginRegion="${region}"/>`,
            `        <WordDetect attribute="Keyword" context="#stay" String="${escapeXml(close)}" endRegion="${region}"/>`,
        );
    }
    return lines.join("\n");
}

// -- Main generator --

/** Generate a complete KSyntaxHighlighting XML string for one language. */
export function generateKshXml(lang: LanguageDef): string {
    const { keywords, functions, constants } = collectKeywords(lang.yamlFiles);
    const caseSensitive = lang.caseIgnored ? "false" : "true";
    const extensions = toExtensionGlobs(lang.ext);

    const keywordItems = keywords.map((k: string) => `        <item>${escapeXml(k)}</item>`).join("\n");
    const functionItems = functions.map((f: string) => `        <item>${escapeXml(f)}</item>`).join("\n");
    const constantItems = constants.map((c: string) => `        <item>${escapeXml(c)}</item>`).join("\n");

    const stringParts = buildStringRules(lang.stringDelimiters);
    const foldingRules = buildFoldingRules(lang.foldingPairs);

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE language>
<!--
  KSyntaxHighlighting definition for ${escapeXml(lang.displayName)}.
  Generated from YAML data by generate-ksh.ts.
  Install to: ~/.local/share/org.kde.syntax-highlighting/syntax/
-->
<language name="${escapeXml(lang.displayName)}" version="1" kateversion="5.0" section="Scripts"
          extensions="${extensions}" casesensitive="${caseSensitive}"
          author="BGforge" license="MIT">
  <highlighting>
    <list name="keywords">
${keywordItems}
    </list>
    <list name="functions">
${functionItems}
    </list>
    <list name="constants">
${constantItems}
    </list>

    <contexts>
      <context name="Normal" attribute="Normal Text" lineEndContext="#stay">
        <DetectSpaces/>
        <Detect2Chars attribute="Comment" context="BlockComment" char="/" char1="*" beginRegion="comment"/>
        <Detect2Chars attribute="Comment" context="LineComment" char="/" char1="/"/>
${stringParts.normalRules}
${foldingRules}
        <keyword attribute="Keyword" context="#stay" String="keywords"/>
        <keyword attribute="Function" context="#stay" String="functions"/>
        <keyword attribute="Constant" context="#stay" String="constants"/>
        <HlCHex attribute="Number" context="#stay"/>
        <Float attribute="Number" context="#stay"/>
        <Int attribute="Number" context="#stay"/>
        <DetectIdentifier/>
      </context>

      <context name="LineComment" attribute="Comment" lineEndContext="#pop">
        <DetectSpaces/>
        <IncludeRules context="##Comments"/>
      </context>

      <context name="BlockComment" attribute="Comment" lineEndContext="#stay">
        <Detect2Chars attribute="Comment" context="#pop" char="*" char1="/" endRegion="comment"/>
        <DetectSpaces/>
        <IncludeRules context="##Comments"/>
      </context>

${stringParts.contexts}
    </contexts>

    <itemDatas>
      <itemData name="Normal Text" defStyleNum="dsNormal"/>
      <itemData name="Keyword" defStyleNum="dsKeyword"/>
      <itemData name="Function" defStyleNum="dsFunction"/>
      <itemData name="Constant" defStyleNum="dsConstant"/>
      <itemData name="Comment" defStyleNum="dsComment"/>
      <itemData name="Number" defStyleNum="dsDecVal"/>
${stringParts.itemDatas}
    </itemDatas>
  </highlighting>

  <general>
    <comments>
      <comment name="singleLine" start="//" position="afterwhitespace"/>
      <comment name="multiLine" start="/*" end="*/" region="comment"/>
    </comments>
    <keywords casesensitive="${caseSensitive}"/>
  </general>
</language>
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
        console.error("Usage: generate-ksh --out-dir <dir>");
        process.exit(1);
    }

    fs.mkdirSync(outDir, { recursive: true });

    for (const lang of LANGUAGES) {
        const xml = generateKshXml(lang);
        const outPath = path.join(outDir, `${lang.name}.xml`);
        fs.writeFileSync(outPath, xml, "utf8");
        console.log(`Created ${outPath}`);
    }
}

const isDirectRun = process.argv[1]?.endsWith("generate-ksh.ts");
if (isDirectRun) {
    main();
}
/* v8 ignore stop */
