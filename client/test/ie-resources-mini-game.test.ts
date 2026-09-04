import { describe, expect, it } from "vitest";
import { miniGame } from "./ie-game-fixtures";
import { readIdsCodes } from "../src/ie-resources/ids-tables";

const decode = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);

describe("the mini game fixture", () => {
    it("serves the tables and INIs an index reads", () => {
        const game = miniGame();
        expect(game.canRead("ANISND", "ids")).toBe(true);
        expect(game.canRead("ANIMATE", "ids")).toBe(true);
        expect(game.canRead("6000", "ini")).toBe(true);
        expect(game.canRead("9999", "ini")).toBe(false);
    });

    it("carries the armour-family split a single-prefix resolver gets wrong", () => {
        const bams = miniGame()
            .list()
            .filter((r) => r.ext === "bam")
            .map((r) => r.resref);
        expect(bams).toContain("CHMB1G1");
        expect(bams).toContain("CHMC4G1");
        expect(bams).not.toContain("CHMB4G1");
    });

    it("carries a set whose paperdoll aliases away from its body", () => {
        const ini = decode(miniGame().read("6004", "ini"));
        expect(ini).toContain("resref=CDMB");
        expect(ini).toContain("resref_paperdoll=CGMC");
        const bams = miniGame()
            .list()
            .filter((r) => r.ext === "bam")
            .map((r) => r.resref);
        expect(bams).toContain("CGMC1INV");
        expect(bams).not.toContain("CDMB1INV");
    });

    it("carries a hex animation_type that is not all digits", () => {
        expect(decode(miniGame().read("A000", "ini"))).toContain("animation_type=a000");
    });

    it("names an id in ANIMATE.IDS that ANISND.IDS does not", () => {
        const game = miniGame();
        const anisnd = readIdsCodes(game.read("ANISND", "ids"));
        const animate = readIdsCodes(game.read("ANIMATE", "ids"));
        expect(animate.has(0xe440)).toBe(true);
        expect(anisnd.has(0xe440)).toBe(false);
    });
});
