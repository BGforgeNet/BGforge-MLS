import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../repo-root";

const repo = (p: string) => path.join(REPO_ROOT, p);
const pkg = JSON.parse(readFileSync(repo("package.json"), "utf8"));
const theme = JSON.parse(readFileSync(repo("themes/bgforge-icon-theme.json"), "utf8"));

// Authoritative source for which formats the binary editor handles: its own selector.
const editor = pkg.contributes.customEditors.find((e: { viewType: string }) => e.viewType === "bgforge.binaryEditor");
const exts: string[] = editor.selector
    .map((s: { filenamePattern?: string }) => s.filenamePattern)
    .filter((p: unknown): p is string => typeof p === "string" && p.startsWith("*."))
    .map((p: string) => p.slice(2));

describe("binary-format file icons", () => {
    it("covers exactly the binary-editor formats declared in package.json", () => {
        // If a new binary format is added, extend the icon theme to match (and update this list).
        expect([...exts].sort()).toEqual(["cre", "eff", "itm", "map", "pro", "spl"]);
    });

    for (const ext of exts) {
        it(`maps .${ext} to a dedicated SVG icon, identical on dark and light themes`, () => {
            const dark = theme.fileExtensions?.[ext];
            const light = theme.light?.fileExtensions?.[ext];
            expect(dark, `.${ext} missing from fileExtensions`).toBeDefined();
            // The glyphs are theme-independent, so both themes point at the same definition.
            expect(light).toBe(dark);

            const def = theme.iconDefinitions?.[dark];
            // A dedicated SVG, not a generic seti font glyph (fontCharacter) or a wrong reuse.
            expect(def?.iconPath, `icon definition "${dark}" has no iconPath`).toMatch(/\.svg$/);
            expect(
                existsSync(repo(path.join("themes", def.iconPath))),
                `icon file ${def.iconPath} does not exist`,
            ).toBe(true);
        });
    }
});

// Fallout proto (.pro) files are typed by their parent folder (proto/items, proto/critters, ...),
// so the icon theme differentiates them via folder-qualified extension keys ("items/pro").
// The canonical layout is fixed by the engine and mirrored by our testFixture/proto/ tree.
describe("Fallout proto per-type file icons", () => {
    const PROTO_ICON: Record<string, string> = {
        items: "fallout-pro-item",
        critters: "infinity-cre", // reuses the .cre creature bust
        scenery: "fallout-pro-scenery",
        walls: "fallout-pro-wall",
        tiles: "fallout-pro-tile",
        misc: "fallout-pro", // shares the generic crate
    };

    it("defaults a bare .pro (no type folder) to the crate icon", () => {
        expect(theme.fileExtensions?.pro).toBe("fallout-pro");
        expect(theme.light?.fileExtensions?.pro).toBe("fallout-pro");
    });

    for (const [folder, defKey] of Object.entries(PROTO_ICON)) {
        const key = `${folder}/pro`;
        it(`maps ${key} to "${defKey}" (dark+light) with a real SVG and a fixture present`, () => {
            expect(theme.fileExtensions?.[key], `${key} missing from fileExtensions`).toBe(defKey);
            expect(theme.light?.fileExtensions?.[key], `${key} missing from light.fileExtensions`).toBe(defKey);

            const def = theme.iconDefinitions?.[defKey];
            expect(def?.iconPath, `icon definition "${defKey}" has no iconPath`).toMatch(/\.svg$/);
            expect(existsSync(repo(path.join("themes", def.iconPath)))).toBe(true);

            // The folder-qualified match only fires for real protos sitting in proto/<folder>/.
            const dir = repo(path.join("client/testFixture/proto", folder));
            expect(
                readdirSync(dir).some((f) => f.endsWith(".pro")),
                `no .pro fixture in ${folder}/`,
            ).toBe(true);
        });
    }
});
