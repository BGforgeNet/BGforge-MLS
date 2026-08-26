/**
 * The language client's document selector.
 *
 * A script view renders a compiled file as source on its own URI scheme, and the server's features reach it
 * only if that scheme is selected here. Nothing else fails when it is missing: the tab still opens, still
 * highlights and still saves, so the gap shows up as "the server does nothing for this file" - which is why
 * it is worth pinning rather than leaving to the next reader of the selector list.
 *
 * One row per script view. A new one adds a row here, and the source of truth for its scheme is the view's
 * own module rather than a string repeated in the test.
 */

import { describe, expect, it, vi } from "vitest";

// The view modules reach vscode for `Uri` alone; the scheme constants they export need none of it.
vi.mock("vscode", () => ({ Uri: { from: () => undefined, parse: () => undefined } }));

const { LSP_DOCUMENT_SELECTOR } = await import("../src/document-selector");
const { BCS_SCHEME } = await import("../src/bcs-editor/document");
const { INT_SCHEME } = await import("../src/int-editor/document");

describe("LSP document selector", () => {
    it.each([
        ["compiled Infinity Engine script", BCS_SCHEME, "weidu-baf"],
        ["compiled Fallout script", INT_SCHEME, "fallout-ssl"],
    ])("selects the %s view's scheme for its source language", (_view, scheme, language) => {
        expect(LSP_DOCUMENT_SELECTOR).toContainEqual({ scheme, language });
    });

    it("selects each script view's language on disk as well", () => {
        // The view scheme is an ADDITION, never a replacement: a `.baf` or `.ssl` that is already source on
        // disk is the ordinary case, and a selector that lost it would still pass the rows above.
        expect(LSP_DOCUMENT_SELECTOR).toContainEqual({ scheme: "file", language: "weidu-baf" });
        expect(LSP_DOCUMENT_SELECTOR).toContainEqual({ scheme: "file", language: "fallout-ssl" });
    });
});
