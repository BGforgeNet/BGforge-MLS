import { describe, expect, it } from "vitest";
import { shouldFetchCreatures } from "../src/image-editor/webview/state/creature-list";

describe("shouldFetchCreatures", () => {
    it("asks the first time the picker is opened", () => {
        // Most files are never recoloured, so the list is fetched on demand rather than at open.
        expect(shouldFetchCreatures(false, false)).toBe(true);
    });

    /**
     * Answered is answered, however short the answer.
     *
     * The decision used to turn on the list being EMPTY, which conflated "no game answered" with "this
     * install lists no creatures" - so an install of the second kind was re-asked every time the picker
     * opened, for the life of the document.
     */
    it("does not ask again once a game has answered", () => {
        expect(shouldFetchCreatures(true, true)).toBe(false);
    });

    it("asks again until a game answers", () => {
        // The note beside the picker asks the reader to open one, so the next open must pick up the game
        // they just opened rather than serving the pre-game emptiness for the rest of the file's life.
        expect(shouldFetchCreatures(true, false)).toBe(true);
    });
});
