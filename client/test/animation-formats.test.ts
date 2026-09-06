/**
 * The animation surface's format list against the manifest's own.
 *
 * Two places state which files this editor draws: `package.json`'s custom-editor selector, which is what
 * VS Code binds, and `ANIMATION_EXTENSIONS`, which is what the gallery asks before drawing an item on its
 * own stage instead of handing it over. Adding a format to one and not the other fails silently in the
 * direction of a file that opens in a tab from the explorer and refuses to draw in the gallery.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { ANIMATION_EXTENSIONS, drawsAnimation } from "../src/image-editor/formats";
import { REPO_ROOT } from "./repo-root";

interface Manifest {
    contributes: { customEditors: { viewType: string; selector: { filenamePattern: string }[] }[] };
}

describe("the animation editor's declared formats", () => {
    it("lists what the manifest binds it to, minus the set address it mints itself", () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as Manifest;
        const editor = manifest.contributes.customEditors.find((entry) => entry.viewType === "bgforge.animationEditor");
        const bound = (editor?.selector ?? [])
            .map((selector) => selector.filenamePattern.replace(/^\*\./, ""))
            // `.animset` is an address this extension builds for a whole set, never a file on disk, so it
            // is bound in the manifest and deliberately absent from the list of drawable FILES.
            .filter((ext) => ext !== "animset");

        expect([...bound].sort()).toEqual([...ANIMATION_EXTENSIONS].sort());
    });

    /** The gallery asks this per item, and an archive spells its extensions upper case. */
    it("answers for an extension whatever case it arrives in, and refuses one it does not draw", () => {
        expect([drawsAnimation("BAM"), drawsAnimation("frm"), drawsAnimation("FR3")]).toEqual([true, true, true]);
        expect([drawsAnimation("bmp"), drawsAnimation("mos")]).toEqual([false, false]);
    });
});
