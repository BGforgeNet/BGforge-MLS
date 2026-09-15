/**
 * Writes the TextMate bundle's grammars, each carrying the file types it claims (`fileTypes`: an extension without
 * its dot, or a whole file name). The grammars VS Code loads declare none, since VS Code maps files through the
 * package.json language contributions, so a bundle of them as they are maps no file in a TextMate host such as a
 * JetBrains IDE. The file types come from those same contributions.
 *
 * A grammar is bundled when its language declares extensions or file names; injection, tooltip and webview grammars
 * declare neither.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/generate-tmbundle-syntaxes.ts --out-dir <bundle>/Syntaxes
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

interface Contributes {
    readonly languages: readonly { id: string; extensions?: string[]; filenames?: string[] }[];
    readonly grammars: readonly { language?: string; path: string }[];
}

interface BundledGrammar {
    /** Grammar path as package.json gives it, relative to the repo root. */
    readonly path: string;
    readonly language: string;
    readonly fileTypes: readonly string[];
}

/** A file type several bundled languages declare goes to one of them, the default docs/file_associations.md names. */
const SHARED_FILE_TYPE_OWNER: Readonly<Record<string, string>> = { ssl: "fallout-ssl" };

/** The bundled grammars and the file types each claims. Throws on a shared file type with no owner named above. */
export function bundleGrammars(contributes: Contributes): BundledGrammar[] {
    const languages = new Map(contributes.languages.map((l) => [l.id, l]));
    const declared = contributes.grammars.flatMap((g) => {
        const lang = g.language === undefined ? undefined : languages.get(g.language);
        if (!lang) return [];
        const fileTypes = [...(lang.extensions ?? []).map((e) => e.replace(/^\./, "")), ...(lang.filenames ?? [])];
        return fileTypes.length > 0 ? [{ path: g.path, language: lang.id, fileTypes }] : [];
    });

    const claimants = new Map<string, string[]>();
    for (const g of declared) {
        for (const t of g.fileTypes) claimants.set(t, [...(claimants.get(t) ?? []), g.language]);
    }
    for (const [fileType, langs] of claimants) {
        const owner = SHARED_FILE_TYPE_OWNER[fileType];
        if (langs.length > 1 && (owner === undefined || !langs.includes(owner))) {
            throw new Error(
                `"${fileType}" is declared by ${langs.join(" and ")}; name the one that keeps it in SHARED_FILE_TYPE_OWNER`,
            );
        }
    }

    return declared.map((g) => ({
        ...g,
        fileTypes: g.fileTypes.filter(
            (t) => claimants.get(t)?.length === 1 || SHARED_FILE_TYPE_OWNER[t] === g.language,
        ),
    }));
}

/** The grammar with its `fileTypes` set; a grammar left with none carries no key. */
export function withFileTypes(grammar: Record<string, unknown>, fileTypes: readonly string[]): Record<string, unknown> {
    const { fileTypes: _replaced, ...rest } = grammar;
    return fileTypes.length > 0 ? { ...rest, fileTypes } : rest;
}

// -- CLI entry point --

/* v8 ignore start -- CLI wrapper */
function main(): void {
    const { values } = parseArgs({ options: { "out-dir": { type: "string" } }, strict: true });
    const outDir = values["out-dir"];
    if (outDir === undefined) {
        console.error("Usage: generate-tmbundle-syntaxes --out-dir <dir>");
        process.exit(1);
    }

    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { contributes: Contributes };
    fs.mkdirSync(outDir, { recursive: true });
    for (const g of bundleGrammars(pkg.contributes)) {
        const grammar = JSON.parse(fs.readFileSync(g.path, "utf8")) as Record<string, unknown>;
        const outPath = path.join(outDir, path.basename(g.path));
        fs.writeFileSync(outPath, JSON.stringify(withFileTypes(grammar, g.fileTypes), null, 2) + "\n", "utf8");
        console.log(`Created ${outPath}`);
    }
}

const isDirectRun = process.argv[1]?.endsWith("generate-tmbundle-syntaxes.ts");
if (isDirectRun) {
    main();
}
/* v8 ignore stop */
