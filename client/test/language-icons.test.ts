import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./repo-root";

const repo = (p: string) => path.join(REPO_ROOT, p);
const pkg = JSON.parse(readFileSync(repo("package.json"), "utf8"));
const theme = JSON.parse(readFileSync(repo("themes/bgforge-icon-theme.json"), "utf8"));

// Text languages (which have a languageId) carry their icon via contributes.languages[].icon
// rather than the icon theme, so the icon shows under ANY active file icon theme - not only
// bgforge's. Binary formats (.pro/.map/.itm/...) have no languageId and stay in the icon theme
// (see binary-editor/icon-theme.test.ts). Same SVG/PNG for light+dark unless a value differs.
const ICON_DIR = "./themes/icons";

interface ContributedLanguage {
    id: string;
    extensions?: string[];
    filenames?: string[];
    icon?: { light?: string; dark?: string };
}

/**
 * Languages VS Code already ships, contributed here only to map extra extensions onto them. They carry their
 * own icon, and this extension has no say in it.
 */
const BUILT_IN = new Set(["typescript"]);

/**
 * The languages that own files on disk, taken from the manifest rather than listed here: a
 * hand-maintained allowlist cannot see a newly contributed language, so the one case worth catching -
 * a `.d`/`.ssl`/`.2da` falling through to whatever the active icon theme guesses - was invisible to it.
 * A language with neither extensions nor filenames (an embedded/tooltip grammar) never labels a file.
 */
const fileBearing: ContributedLanguage[] = (pkg.contributes.languages as ContributedLanguage[]).filter(
    (lang) => !BUILT_IN.has(lang.id) && ((lang.extensions?.length ?? 0) > 0 || (lang.filenames?.length ?? 0) > 0),
);

/**
 * The file-bearing languages this manifest declares no icon for. Listed so an addition is a deliberate
 * edit here rather than a silent omission; a new language must either ship an icon or join this list.
 */
const WITHOUT_ICON = new Set(["fallout-scripts-lst", "weidu-log"]);

describe("language file icons (contributes.languages[].icon)", () => {
    it("covers every language that owns files, so a new one cannot be added unnoticed", () => {
        // Guards the guard: an empty or collapsed manifest read would make every case below vacuous.
        expect(fileBearing.length).toBeGreaterThan(WITHOUT_ICON.size);
        const declared = new Set(fileBearing.map((lang) => lang.id));
        for (const id of WITHOUT_ICON) {
            expect(declared.has(id), `${id} is no longer a file-bearing language - drop it from WITHOUT_ICON`).toBe(
                true,
            );
        }
    });

    for (const lang of fileBearing.filter((entry) => !WITHOUT_ICON.has(entry.id))) {
        it(`${lang.id} declares dark+light icons pointing at real files`, () => {
            for (const variant of ["dark", "light"] as const) {
                const declared = lang.icon?.[variant];
                expect(declared, `${lang.id} missing icon.${variant}`).toBeDefined();
                expect(declared?.startsWith(`${ICON_DIR}/`), `${lang.id} icon.${variant} outside ${ICON_DIR}`).toBe(
                    true,
                );
                expect(
                    existsSync(repo(declared ?? "")),
                    `${lang.id} icon.${variant} (${declared}) does not exist`,
                ).toBe(true);
            }
        });
    }

    it("does not also map these languages in the icon theme (contributes is the single source)", () => {
        // A theme languageIds entry would shadow the contributed icon under bgforge's own theme,
        // re-introducing the duplication this switch removed.
        for (const { id } of fileBearing) {
            if (WITHOUT_ICON.has(id)) continue;
            expect(theme.languageIds?.[id], `${id} still mapped in theme.languageIds`).toBeUndefined();
            expect(theme.light?.languageIds?.[id], `${id} still mapped in theme.light.languageIds`).toBeUndefined();
        }
    });
});
