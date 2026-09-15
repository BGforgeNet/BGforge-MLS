import { describe, expect, it } from "vitest";
import { shouldFetchCreatures } from "../src/image-editor/webview/state/creature-list";

describe("shouldFetchCreatures", () => {
    it("asks the first time the picker is opened", () => {
        // Most files are never recoloured, so the list is fetched on demand rather than at open.
        expect(shouldFetchCreatures(false, 0)).toBe(true);
    });

    it("does not ask again once a list has arrived", () => {
        expect(shouldFetchCreatures(true, 12)).toBe(false);
    });

    it("asks again while the answer is empty", () => {
        // An empty list means no game is open - which the note beside it tells the reader to fix. Latching on
        // that answer is what left the picker empty for the rest of the file's life after they did.
        expect(shouldFetchCreatures(true, 0)).toBe(true);
    });
});
