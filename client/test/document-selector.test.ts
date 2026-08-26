/**
 * The language client's document selector.
 *
 * A document the client does not select still opens, still highlights and still saves - it just gets nothing
 * from the server, which reads as the server being broken rather than as the document never being selected.
 * Nothing else fails, so the property is worth pinning.
 *
 * Two derivations are pinned, because both were once hand-listed and both were one entry short: a language is
 * selected on every scheme a document of ours can arrive on, and the decompiled-script scheme is selected for
 * every language the format registry names.
 */

import { describe, expect, it, vi } from "vitest";
import pkg from "../../package.json";

// `ie-resources/uri` reaches vscode for `Uri`; the scheme constant it exports needs none of it.
vi.mock("vscode", () => ({ Uri: { from: () => undefined, parse: () => undefined } }));

const { LSP_DOCUMENT_SELECTOR } = await import("../src/document-selector");
const { GAME_RESOURCE_SCHEME } = await import("../src/ie-resources/uri");
const { SCRIPT_FORMATS, SCRIPT_VIEW_SCHEME } = await import("../src/script-view/formats");

describe("the LSP document selector", () => {
    it.each(SCRIPT_FORMATS.map((format) => [format.ext, format.language]))(
        "selects a decompiled .%s as %s",
        (_ext, language) => {
            expect(LSP_DOCUMENT_SELECTOR).toContainEqual({ scheme: SCRIPT_VIEW_SCHEME, language });
        },
    );

    it("selects the same languages on disk, where they are ordinary source", () => {
        // The view scheme is an ADDITION, never a replacement: a `.baf` or `.ssl` already on disk is the
        // ordinary case, and a selector that lost it would still satisfy the rows above.
        for (const { language } of SCRIPT_FORMATS) {
            expect(LSP_DOCUMENT_SELECTOR).toContainEqual({ scheme: "file", language });
        }
    });

    it("selects every language it selects on disk on the game-resource scheme too", () => {
        // A game archive serves 2DA tables and the like as text that never touches disk. Selecting `file:`
        // alone left those tabs with highlighting and no server features at all.
        const onScheme = (scheme: string): string[] =>
            LSP_DOCUMENT_SELECTOR.filter((filter) => "scheme" in filter && filter.scheme === scheme)
                .map((filter) => ("language" in filter ? filter.language : undefined))
                .filter((language): language is string => language !== undefined);

        const onDisk = onScheme("file");
        const inArchive = new Set(onScheme(GAME_RESOURCE_SCHEME));

        expect(onDisk.filter((language) => !inArchive.has(language))).toEqual([]);
        expect(inArchive.has("infinity-2da")).toBe(true);
    });

    it("selects exactly the languages the manifest starts the extension for", () => {
        // Two copies of one list: without an `onLanguage:` event the extension never starts, and without a
        // selector entry it starts and then ignores the file. Neither failure says anything at runtime, and
        // the manifest cannot read this module - VS Code reads it before any code runs - so they are held
        // together here instead.
        const activated = pkg.activationEvents
            .filter((event) => event.startsWith("onLanguage:"))
            .map((event) => event.slice("onLanguage:".length))
            .sort();
        const selected = [
            ...new Set(
                LSP_DOCUMENT_SELECTOR.filter((filter) => "language" in filter && filter.language !== undefined).map(
                    (filter) => (filter as { language: string }).language,
                ),
            ),
        ].sort();

        expect(selected).toEqual(activated);
    });

    it("carries no filter naming neither a language nor a pattern", () => {
        // Such a filter matches every document on its scheme, which would attach the client to files no
        // provider answers for.
        for (const filter of LSP_DOCUMENT_SELECTOR) {
            const named = ("language" in filter && filter.language) || ("pattern" in filter && filter.pattern);
            expect(named, JSON.stringify(filter)).toBeTruthy();
        }
    });
});
