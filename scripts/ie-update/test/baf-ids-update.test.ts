import { describe, expect, it } from "vitest";
import { parseIdsHtml } from "../src/baf-ids-update.ts";

describe("parseIdsHtml", () => {
    it("extracts value/name pairs from IESDP rows, stripping tags", () => {
        const html = ["0x0000 FIRE_RING<br />", "0x0100 CHUNKS<br />"].join("\n");
        expect(parseIdsHtml(html, "animate.ids")).toEqual([
            { name: "FIRE_RING", detail: "0x0000", doc: "animate.ids" },
            { name: "CHUNKS", detail: "0x0100", doc: "animate.ids" },
        ]);
    });

    it("keeps hyphenated names intact (name is the whole second token)", () => {
        expect(parseIdsHtml("0x7f20 KUO-TOA<br />", "animate.ids")).toEqual([
            { name: "KUO-TOA", detail: "0x7f20", doc: "animate.ids" },
        ]);
    });

    it("takes the first name token and ignores a trailing description", () => {
        expect(parseIdsHtml("198 NOTNEUTRAL (used by neutrals)<br />", "ea.ids")).toEqual([
            { name: "NOTNEUTRAL", detail: "198", doc: "ea.ids" },
        ]);
    });

    it("reads a value/name pair out of an idsHeader anchor row", () => {
        expect(parseIdsHtml('<div class="idsHeader"><a name="2">2 PC</a></div>', "ea.ids")).toEqual([
            { name: "PC", detail: "2", doc: "ea.ids" },
        ]);
    });

    it("does not let a bare count line grab the next row's value", () => {
        // A standalone "126" (an entry-count line in the page header) must not consume the following row's
        // value as its name - the regression that a whole-string `\s+` match caused.
        const html = ["126<br />", "0x0000 FIRE_RING<br />"].join("\n");
        expect(parseIdsHtml(html, "animate.ids")).toEqual([
            { name: "FIRE_RING", detail: "0x0000", doc: "animate.ids" },
        ]);
    });

    it("keeps the first occurrence of a duplicated name", () => {
        const html = ["1 SAME<br />", "2 SAME<br />"].join("\n");
        expect(parseIdsHtml(html, "x.ids")).toEqual([{ name: "SAME", detail: "1", doc: "x.ids" }]);
    });
});
