import { describe, expect, it } from "vitest";
import { GALLERY_TABS, resolveTab, showTabStrip, tabLabel } from "../src/gallery/webview/tabs";

describe("resolveTab", () => {
    it("shows the sets tab when the panel has animations behind it", () => {
        expect(resolveTab("sets", true)).toBe("sets");
    });

    it("falls back to files when nothing can fill the sets tab", () => {
        // A workspace gallery has no game, and a panel VS Code restored without its state defaults to the
        // workspace - so a stored "sets" must not come back as an empty grid.
        expect(resolveTab("sets", false)).toBe("files");
    });

    it("shows files when no tab was asked for", () => {
        expect(resolveTab(undefined, true)).toBe("files");
        expect(resolveTab(undefined, false)).toBe("files");
    });
});

describe("the tab strip", () => {
    it("is hidden when there is only one tab to show", () => {
        expect(showTabStrip(false)).toBe(false);
        expect(showTabStrip(true)).toBe(true);
    });

    it("labels every tab it can show", () => {
        expect(GALLERY_TABS.map((tab) => tabLabel(tab))).toEqual(["Files", "Animation sets"]);
    });
});
