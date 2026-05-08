/**
 * Generates Geany filetype definition (.conf) files from YAML data.
 * Produces one .conf per language for use in Geany's custom filetypes.
 * Users install by copying to ~/.config/geany/filedefs/
 *
 * All languages use the C lexer (lexer_filetype=C) because our languages share
 * C-style comments (// and block comments) and double-quoted strings. The C lexer
 * provides correct highlighting for these constructs plus numbers and keywords.
 * Tilde-quoted strings (~text~) are not supported by the C lexer.
 *
 * Geany's C lexer supports three keyword groups: primary, secondary, docComment.
 * We map: keywords -> primary, functions -> secondary, constants -> docComment.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/generate-geany.ts --out-dir <dir>
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { LANGUAGES, collectKeywords, type LanguageDef } from "./language-defs.ts";

/** Convert space-separated extensions to semicolon-separated list. */
function toExtensionList(ext: string): string {
    return ext.split(" ").join(";");
}

/** Generate a complete Geany filetype .conf file for one language. */
export function generateGeanyConf(lang: LanguageDef): string {
    const { keywords, functions, constants } = collectKeywords(lang.yamlFiles);
    const extensions = toExtensionList(lang.ext);

    // Geany requires all keywords on a single line per group.
    const primaryLine = keywords.join(" ");
    const secondaryLine = functions.join(" ");
    const docCommentLine = constants.join(" ");

    return `# Geany filetype definition for ${lang.displayName}.
# Generated from YAML data by generate-geany.ts.
# Install to: ~/.config/geany/filedefs/

[styling=C]

[keywords]
primary=${primaryLine}
secondary=${secondaryLine}
doccomment=${docCommentLine}

[settings]
lexer_filetype=C
extension=${extensions}
comment_single=//
comment_open=/*
comment_close=*/

[indentation]
type=0
width=4
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
        console.error("Usage: generate-geany --out-dir <dir>");
        process.exit(1);
    }

    fs.mkdirSync(outDir, { recursive: true });

    for (const lang of LANGUAGES) {
        // Skip languages with no YAML data - they get hand-written static files instead
        if (lang.yamlFiles.length === 0) continue;

        const conf = generateGeanyConf(lang);
        const outPath = path.join(outDir, `filetypes.${lang.name}.conf`);
        fs.writeFileSync(outPath, conf, "utf8");
        console.log(`Created ${outPath}`);
    }
}

const isDirectRun = process.argv[1]?.endsWith("generate-geany.ts");
if (isDirectRun) {
    main();
}
/* v8 ignore stop */
