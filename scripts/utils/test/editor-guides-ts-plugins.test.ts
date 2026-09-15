/**
 * The TypeScript plugin names the editor guides tell users to configure are the files the server package ships.
 *
 * tsserver resolves each `@bgforge/mls-server/out/<name>` as a package import, so a guide naming a file that
 * scripts/publish-server.sh does not build fails only in the user's editor, where tsserver logs the miss and loads
 * nothing. Every guide with a TypeScript plugins section names every shipped plugin.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const GUIDES_DIR = path.join(REPO_ROOT, "docs/editors");
const PUBLISH_SCRIPT = fs.readFileSync(path.join(REPO_ROOT, "scripts/publish-server.sh"), "utf8");

const SHIPPED = [...PUBLISH_SCRIPT.matchAll(/--outfile=server\/out\/([\w-]+-plugin)\.js/g)].map((m) => m[1]!).sort();

const GUIDES = fs
    .readdirSync(GUIDES_DIR)
    .filter((name) => name.endsWith(".md") && name !== "README.md" && name !== "typescript-plugins.md")
    .sort();

describe("editor guides name the shipped TypeScript plugins", () => {
    it("finds the plugins the server package builds", () => {
        expect(SHIPPED).toEqual(["td-plugin", "tssl-plugin"]);
    });

    describe.each(GUIDES)("%s", (guide) => {
        const text = fs.readFileSync(path.join(GUIDES_DIR, guide), "utf8");
        const named = [...new Set([...text.matchAll(/@bgforge\/mls-server\/out\/([\w-]+)/g)].map((m) => m[1]!))].sort();

        it("names exactly the shipped plugins", () => {
            expect(text.includes("## TypeScript plugins (TSSL/TD)"), `${guide} has no TypeScript plugins section`).toBe(
                true,
            );
            expect(named, `${guide} plugin names differ from what scripts/publish-server.sh builds`).toEqual(SHIPPED);
        });
    });
});
