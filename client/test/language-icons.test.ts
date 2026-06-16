import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Tests run with the repo root as cwd (see other client tests using path.resolve("client/...")).
const repo = (p: string) => path.resolve(p);
const pkg = JSON.parse(readFileSync(repo("package.json"), "utf8"));
const theme = JSON.parse(readFileSync(repo("themes/bgforge-icon-theme.json"), "utf8"));

// Text languages (which have a languageId) carry their icon via contributes.languages[].icon
// rather than the icon theme, so the icon shows under ANY active file icon theme - not only
// bgforge's. Binary formats (.pro/.map/.itm/...) have no languageId and stay in the icon theme
// (see binary-editor/icon-theme.test.ts). Same SVG/PNG for light+dark unless a value differs.
const ICON_DIR = "./themes/icons";
const LANGUAGE_ICON: Record<string, { dark: string; light: string }> = {
    "fallout-ssl": { dark: "fallout-ssl.svg", light: "fallout-ssl.svg" },
    "fallout-msg": { dark: "seti-msg-tra.svg", light: "seti-msg-tra.svg" },
    "weidu-tra": { dark: "seti-msg-tra.svg", light: "seti-msg-tra.svg" },
    "weidu-tp2": { dark: "weidu-tp2.png", light: "weidu-tp2.png" },
    "weidu-baf": { dark: "weidu-baf.png", light: "weidu-baf.png" },
    "weidu-slb": { dark: "weidu-baf.png", light: "weidu-baf.png" }, // aliases the baf icon
    "weidu-ssl": { dark: "weidu-baf.png", light: "weidu-baf.png" }, // aliases the baf icon
    "infinity-2da": { dark: "infinity-2da.svg", light: "infinity-2da-light.svg" },
    "fallout-worldmap-txt": {
        dark: "fallout-worldmap-txt.svg",
        light: "fallout-worldmap-txt-light.svg",
    },
};

const langById = new Map<string, { icon?: { light?: string; dark?: string } }>(
    pkg.contributes.languages.map((l: { id: string }) => [l.id, l]),
);

describe("language file icons (contributes.languages[].icon)", () => {
    for (const [id, { dark, light }] of Object.entries(LANGUAGE_ICON)) {
        it(`${id} declares dark+light icons pointing at real files`, () => {
            const lang = langById.get(id);
            expect(lang, `no language entry with id "${id}"`).toBeDefined();
            expect(lang?.icon?.dark, `${id} missing icon.dark`).toBe(`${ICON_DIR}/${dark}`);
            expect(lang?.icon?.light, `${id} missing icon.light`).toBe(`${ICON_DIR}/${light}`);
            for (const file of new Set([dark, light])) {
                expect(existsSync(repo(path.join("themes/icons", file))), `icon file ${file} does not exist`).toBe(
                    true,
                );
            }
        });
    }

    it("does not also map these languages in the icon theme (contributes is the single source)", () => {
        // A theme languageIds entry would shadow the contributed icon under bgforge's own theme,
        // re-introducing the duplication this switch removed.
        for (const id of Object.keys(LANGUAGE_ICON)) {
            expect(theme.languageIds?.[id], `${id} still mapped in theme.languageIds`).toBeUndefined();
            expect(theme.light?.languageIds?.[id], `${id} still mapped in theme.light.languageIds`).toBeUndefined();
        }
    });
});
