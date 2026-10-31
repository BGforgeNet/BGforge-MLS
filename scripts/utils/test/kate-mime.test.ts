/**
 * The Kate bundle's shared-mime-info definitions cover every file the extension contributes a language for, and
 * each type whose language has a scalable icon ships that icon under the type's name.
 *
 * Kate and the rest of KDE draw a file's icon from its XDG MIME type, so a language missing from
 * `editors/kate/bgforge-mls.mime.xml` keeps the generic icon there however its VS Code icon is set. The
 * languages are read from the manifest, so a newly contributed one cannot slip past a hand-kept list.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

interface ContributedLanguage {
    id: string;
    extensions?: string[];
    filenames?: string[];
    icon?: { dark?: string };
}

const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
    contributes: { languages: ContributedLanguage[] };
};
const mimeXml = fs.readFileSync(path.join(REPO_ROOT, "editors/kate/bgforge-mls.mime.xml"), "utf8");
const buildScript = fs.readFileSync(path.join(REPO_ROOT, "scripts/build-editors.sh"), "utf8");

/** Languages VS Code ships itself; the manifest only maps extra extensions onto them. */
const BUILT_IN = new Set(["typescript"]);

/** Globs left out on purpose, each with why; checked both ways so the list cannot go stale. */
const EXCLUDED: Record<string, string> = {
    "*.h": "C and C++ headers own it",
    "*.d": "the D programming language owns it",
};

/** MIME type of each glob in the bundle. */
const typeOfGlob = new Map<string, string>();
for (const [, type, body] of mimeXml.matchAll(/<mime-type type="([^"]+)">([\s\S]*?)<\/mime-type>/g)) {
    for (const [, glob] of body!.matchAll(/<glob pattern="([^"]+)"/g)) typeOfGlob.set(glob!, type!);
}

const languages = pkg.contributes.languages.filter((lang) => !BUILT_IN.has(lang.id));
const globsOf = (lang: ContributedLanguage): string[] => [
    ...(lang.extensions ?? []).map((extension) => `*${extension}`),
    ...(lang.filenames ?? []),
];

describe("Kate MIME bundle", () => {
    it("has a type for every file a contributed language claims, apart from the listed exclusions", () => {
        const claimed = new Set(languages.flatMap((lang) => globsOf(lang)));

        expect([...claimed].filter((glob) => !typeOfGlob.has(glob) && !(glob in EXCLUDED))).toEqual([]);
        expect(Object.keys(EXCLUDED).filter((glob) => !claimed.has(glob) || typeOfGlob.has(glob))).toEqual([]);
    });

    it("ships each type's scalable language icon under the type's name", () => {
        const expected = languages.flatMap((lang) => {
            const icon = lang.icon?.dark;
            if (!icon?.endsWith(".svg")) return [];
            return globsOf(lang)
                .filter((glob) => typeOfGlob.has(glob))
                .map(
                    (glob) =>
                        `cp ${path.posix.normalize(icon)} "$dir/mimetypes/${typeOfGlob.get(glob)!.replace("/", "-")}.svg"`,
                );
        });

        expect(expected.filter((line) => !buildScript.includes(line))).toEqual([]);
    });
});
