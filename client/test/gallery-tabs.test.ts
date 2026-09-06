import { describe, expect, it } from "vitest";
import { GALLERY_TABS, resolveTab, showTabStrip, tabLabel, viewerMounted } from "../src/gallery/webview/tabs";

/**
 * The sets tab IS the animation surface, so it draws its whole self from the moment it opens rather than
 * staying bare until something is chosen. Both readers of this take the same answer: the template renders
 * the surface, and the `showing` handler decides whether a first selection still needs the ready handshake.
 */
describe("viewerMounted", () => {
    it("mounts the surface on the sets tab with nothing chosen", () => {
        expect(viewerMounted("sets", false)).toBe(true);
    });

    /**
     * The regression this pins: read apart, the two callers disagreed - the surface rendered on the empty
     * tab while the handshake still assumed a mount was coming, so the first set chosen there was never
     * asked for and the tab sat idle with its name in the picker.
     */
    it("still counts as mounted when the first set arrives, so the handshake fires", () => {
        expect(viewerMounted("sets", true)).toBe(true);
    });

    it("keeps the surface on the files tab only while something is drawn there", () => {
        expect(viewerMounted("files", true)).toBe(true);
        expect(viewerMounted("files", false)).toBe(false);
    });
});

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
