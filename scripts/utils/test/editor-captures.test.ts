/**
 * The guard that makes per-editor queries verifiable without running an editor: every capture we emit
 * for a target must be one that target actually styles.
 *
 * This is the check that was missing when the queries were Neovim-only. Helix rendered numbers as plain
 * text and Zed left 135 capture uses unstyled, and nothing failed - the queries were valid tree-sitter,
 * just addressed to the wrong vocabulary. Asserting against the vendored capture sets catches the next
 * one at the commit that introduces it.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CAPTURE_MAPPINGS, capturesOf, mapQuery, supports, type Editor } from "../src/editor-captures.ts";

// Anchored to this file, not cwd: vitest runs this config from the repo root and from scripts/.
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const EDITORS: readonly Editor[] = ["neovim", "helix", "zed"];

const GRAMMARS = fs
    .readdirSync(path.join(repoRoot, "grammars"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(repoRoot, "grammars", e.name, "queries/highlights.scm")))
    .map((e) => e.name)
    .sort();

function canonicalQuery(grammar: string): string {
    return fs.readFileSync(path.join(repoRoot, "grammars", grammar, "queries/highlights.scm"), "utf-8");
}

describe("per-editor highlight queries", () => {
    it("finds every grammar's canonical query", () => {
        expect(GRAMMARS).toEqual(["fallout-msg", "fallout-ssl", "weidu-baf", "weidu-d", "weidu-tp2", "weidu-tra"]);
    });

    for (const editor of EDITORS) {
        describe(editor, () => {
            for (const grammar of GRAMMARS) {
                it(`${grammar}: every emitted capture is styled`, () => {
                    const emitted = capturesOf(mapQuery(editor, canonicalQuery(grammar)));
                    expect(emitted.length).toBeGreaterThan(0);
                    expect(emitted.filter((c) => !supports(editor, c))).toEqual([]);
                });
            }
        });
    }

    it("maps only captures the grammars actually use", () => {
        const used = new Set(GRAMMARS.flatMap((g) => capturesOf(canonicalQuery(g))));
        const stale = EDITORS.flatMap((e) => Object.keys(CAPTURE_MAPPINGS[e]).filter((c) => !used.has(c)));
        expect(stale).toEqual([]);
    });

    it("maps only captures that need it - an entry whose canonical name already works is noise", () => {
        const pointless = EDITORS.flatMap((e) =>
            Object.keys(CAPTURE_MAPPINGS[e])
                .filter((c) => supports(e, c))
                // Helix styles these under a coarser parent already; the mapping buys a distinct colour
                // rather than fixing an absence, so it is deliberate rather than redundant.
                .filter((c) => !(e === "helix" && c.startsWith("keyword.")))
                .map((c) => `${e}:${c}`),
        );
        expect(pointless).toEqual([]);
    });

    it("rewrites code lines but not the header comments that document canonical names", () => {
        const source = ["; number -> @number", "(number) @number", "(x) @keyword.modifier"].join("\n");
        expect(mapQuery("helix", source).split("\n")).toEqual([
            "; number -> @number",
            "(number) @constant.numeric",
            "(x) @keyword.storage.modifier",
        ]);
    });

    // Neovim reads the canonical file unchanged because it is written in Neovim's convention. A mapping
    // entry for any other editor is a decision to re-examine rather than a detail, so the two that exist
    // are named here: Helix uses TextMate scope names throughout, and Zed's themes define no `character`
    // root for a character literal to fall back to, which is the single capture it has to rename.
    it("leaves the canonical file untouched for neovim", () => {
        for (const grammar of GRAMMARS) {
            expect(mapQuery("neovim", canonicalQuery(grammar))).toBe(canonicalQuery(grammar));
        }
    });

    it("rewrites exactly one capture for zed", () => {
        expect(Object.keys(CAPTURE_MAPPINGS.zed)).toEqual(["character"]);
    });
});
