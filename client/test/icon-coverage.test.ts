/**
 * Every file type the extension claims gets an icon from somewhere.
 *
 * The binary-editor suite pins that its own six formats have dedicated SVGs. This one asks the broader
 * question that suite cannot: is there ANY icon route for each type the manifest claims - a mapping in our
 * icon theme, a `contributes.languages[].icon` (which VS Code falls back to under any theme), or a
 * `languageIds` entry. Because that suite reads only the binary editor's selector, `.bcs`, `.bs`, `.int`
 * and `.dlg` shipped with no icon at all and nothing failed.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./repo-root";

const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
const theme = JSON.parse(readFileSync(path.join(REPO_ROOT, "themes/bgforge-icon-theme.json"), "utf8"));

interface Claim {
    /** `.baf`, or a bare filename such as `weidu.log`. */
    target: string;
    /** Language ids claiming it; empty for a format only a custom editor opens. */
    languages: string[];
}

function claims(): Claim[] {
    const byTarget = new Map<string, Set<string>>();
    const add = (target: string, language?: string) => {
        const set = byTarget.get(target.toLowerCase()) ?? new Set<string>();
        if (language !== undefined) set.add(language);
        byTarget.set(target.toLowerCase(), set);
    };
    for (const language of pkg.contributes.languages) {
        for (const ext of language.extensions ?? []) add(ext, language.id);
        for (const name of language.filenames ?? []) add(name, language.id);
    }
    for (const editor of pkg.contributes.customEditors) {
        for (const selector of editor.selector) {
            const pattern: string | undefined = selector.filenamePattern;
            if (pattern?.startsWith("*.")) add(pattern.slice(1));
        }
    }
    return [...byTarget].map(([target, languages]) => ({ target, languages: [...languages] }));
}

/** The icon route the theme or the manifest gives `claim`, or undefined when nothing supplies one. */
function iconRoute(claim: Claim): string | undefined {
    const { target, languages } = claim;
    const isFilename = !target.startsWith(".");
    // A key absent from `light` is not unstyled: that section overrides the default, so the default stands.
    const extension = isFilename ? target.split(".").pop() : target.slice(1);
    if (isFilename && theme.fileNames?.[target] !== undefined) return `fileNames:${target}`;
    if (extension !== undefined && theme.fileExtensions?.[extension] !== undefined) {
        return `fileExtensions:${extension}`;
    }
    for (const language of languages) {
        const declared = pkg.contributes.languages.find((l: { id: string }) => l.id === language);
        if (declared?.icon !== undefined) return `languages[${language}].icon`;
        if (theme.languageIds?.[language] !== undefined) return `languageIds:${language}`;
    }
    return undefined;
}

describe("icon coverage", () => {
    for (const claim of claims().sort((a, b) => a.target.localeCompare(b.target))) {
        const by = claim.languages.length > 0 ? claim.languages.join(", ") : "a custom editor only";
        it(`gives ${claim.target} an icon (claimed by ${by})`, () => {
            expect(iconRoute(claim), `${claim.target} has no icon from the theme or the manifest`).toBeDefined();
        });
    }

    // A compiled artifact and its source read as a pair: the same shape in a different colour, so a
    // recolour that collapses the pair is a visible regression rather than a private detail.
    const PAIRS: [string, string][] = [
        ["baf", "bcs"],
        ["baf", "bs"],
        ["d", "dlg"],
    ];
    for (const [source, compiled] of PAIRS) {
        it(`.${compiled} is styled as the compiled counterpart of .${source}`, () => {
            const compiledIcon = theme.iconDefinitions[theme.fileExtensions[compiled]];
            expect(compiledIcon, `.${compiled} has no icon definition`).toBeDefined();
            if (compiledIcon.fontCharacter !== undefined) {
                // Same glyph as the source, differing only in colour.
                const sourceIcon = theme.iconDefinitions[theme.fileExtensions[source]];
                expect(compiledIcon.fontCharacter).toBe(sourceIcon.fontCharacter);
                expect(compiledIcon.fontColor).not.toBe(sourceIcon.fontColor);
            } else {
                expect(compiledIcon.iconPath).toMatch(/\.(svg|png)$/);
            }
        });
    }
});
