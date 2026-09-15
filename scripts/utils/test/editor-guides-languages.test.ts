/**
 * Every external-editor guide registers every language the server answers for.
 *
 * The guides are self-contained per editor, so each carries its own copy of the served language ids, and a
 * language added to the server leaves every copy one short with nothing failing: the editor simply gets no
 * server features for that file type. The served set is the manifest's `onLanguage:` activation events,
 * which client/test/document-selector.test.ts already holds equal to the client's document selector.
 *
 * A guide may leave a language out only where its editor bundle ships no definition to attach it to; each such
 * gap is listed below, and the list is checked in both directions so it cannot go stale.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const GUIDES_DIR = path.join(REPO_ROOT, "docs/editors");

const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
    activationEvents: string[];
};
const SERVED = pkg.activationEvents
    .filter((event) => event.startsWith("onLanguage:"))
    .map((event) => event.slice("onLanguage:".length));

/** Guides that set up the language server; the index and the TS-plugin guide do not. */
const GUIDES = fs
    .readdirSync(GUIDES_DIR)
    .filter((name) => name.endsWith(".md") && name !== "README.md" && name !== "typescript-plugins.md")
    .sort();

/** Languages a guide cannot register because its editor bundle defines no file type for them. */
const NO_BUNDLE_DEFINITION: Readonly<Record<string, readonly string[]>> = {
    "geany.md": ["fallout-msg", "fallout-scripts-lst", "infinity-2da", "weidu-log", "weidu-slb", "weidu-ssl"],
    "kate.md": ["weidu-log", "weidu-slb", "weidu-ssl"],
    "notepadpp.md": ["weidu-log", "weidu-slb", "weidu-ssl"],
};

describe("editor guides register the served languages", () => {
    it("finds the served languages and the guides", () => {
        expect(SERVED.length).toBeGreaterThan(0);
        expect(GUIDES.length).toBeGreaterThan(0);
    });

    describe.each(GUIDES)("%s", (guide) => {
        const text = fs.readFileSync(path.join(GUIDES_DIR, guide), "utf8");
        const exempt = NO_BUNDLE_DEFINITION[guide] ?? [];

        it.each(SERVED.filter((id) => !exempt.includes(id)))("names language id %s", (id) => {
            expect(text.includes(id), `${guide} never names the served language id ${id}`).toBe(true);
        });

        it.each(exempt.map((id) => [id]))("exemption for %s is still needed", (id) => {
            expect(SERVED, `${id} is exempted for ${guide} but the server no longer serves it`).toContain(id);
            expect(text.includes(id), `${guide} now names ${id}; drop it from NO_BUNDLE_DEFINITION`).toBe(false);
        });
    });
});
