/**
 * The labels the two set pickers share.
 *
 * Worth its own test because both controls read from here: the stand-in picker shown before anything is
 * drawn, and the dropdown in the drawn surface's controls column. A reader who found a set by one spelling
 * has to find it by the same spelling in the other, and only a shared builder guarantees that.
 */
import { describe, expect, it } from "vitest";
import { type SetTile } from "../src/gallery/webview/messages";
import { setOptions } from "../src/gallery/webview/set-options";

const tile = (over: Partial<SetTile>): SetTile => ({
    id: 0x6201,
    label: "MAGE_MALE_ELF",
    resref: "CEMW1G1",
    unsupported: undefined,
    ...over,
});

describe("setOptions", () => {
    it("carries the name, the padded id and the resref a reader arrives with", () => {
        expect(setOptions([tile({})])).toEqual([{ value: "25089", label: "MAGE_MALE_ELF 0x6201 (CEMW1G1)" }]);
    });

    /** The id is padded so a short one lines up with the rest rather than reading as a different width. */
    it("pads a short id to four digits", () => {
        expect(setOptions([tile({ id: 0x12 })])[0]?.label).toBe("MAGE_MALE_ELF 0x0012 (CEMW1G1)");
    });

    /**
     * A set the install names but cannot draw stays in the list and says so: dropping it would read as the
     * picker having forgotten an animation the tables clearly declare.
     */
    it("keeps a set that draws nothing, and says that in the option", () => {
        expect(setOptions([tile({ resref: undefined })])[0]?.label).toBe("MAGE_MALE_ELF 0x6201 - draws nothing");
    });

    it("has no options for an install that declares no sets", () => {
        expect(setOptions([])).toEqual([]);
    });
});
