import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BcsSymbols } from "../../compilers/bcs/src/index";
import { bcsEngineForScriptStyle, render, sourcePath } from "../src/bcs-editor/document";

/**
 * What a `.bcs` tab shows.
 *
 * The install-gating is the part worth pinning: a script's every name is a number the game's own IDS tables
 * resolve, so without a game the only faithful rendering is bare numbers - and the view says so instead.
 */
const written: string[] = [];

function bcsFile(body: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-bcs-"));
    const file = path.join(dir, "test.bcs");
    fs.writeFileSync(file, body, "latin1");
    written.push(dir);
    return file;
}

afterEach(() => {
    for (const dir of written.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// One block: a False() condition and a Continue() response, in the marker form a real file uses.
const SCRIPT =
    'SC\nCR\nCO\nTR\n16432 0 0 0 0"" ""OB\n0 0 0 0 0 0 0 0 0 0 0 0 ""OB\nTR\nCO\nRS\nRE\n100AC\n36OB\n' +
    '0 0 0 0 0 0 0 0 0 0 0 0 ""OB\nOB\n0 0 0 0 0 0 0 0 0 0 0 0 ""OB\nOB\n0 0 0 0 0 0 0 0 0 0 0 0 ""OB\n' +
    '0 0 0 0 0"" ""AC\nRE\nRS\nCR\nSC\n';

const SYMBOLS: BcsSymbols = {
    trigger: (id) => (id === 16432 ? ["False()"] : []),
    action: (id) => (id === 36 ? ["Continue()"] : []),
    ids: () => undefined,
};

const NAMING = { symbols: SYMBOLS, engine: "bg" } as const;

describe("the decompiled view of a .bcs", () => {
    it("decompiles the script when the document has a game behind it", () => {
        const text = render(bcsFile(SCRIPT), NAMING);

        expect(text).toBe(["IF", "  False()", "THEN", "  RESPONSE #100", "    Continue()", "END", ""].join("\n"));
    });

    /**
     * Without a game the numbers cannot be named, and printing them would look like a decompilation that had
     * simply lost every name. The notice has to say what to do about it, so it names both ways to open a game.
     */
    it("explains itself rather than printing bare numbers when there is no game", () => {
        const text = render(bcsFile(SCRIPT), undefined);

        expect(text).toContain("needs the game it belongs to");
        expect(text).toContain("bgforge.weidu.gamePath");
        expect(text).not.toContain("16432");
        // Still a valid BAF document, so the tab does not render as broken source.
        expect(
            text
                .split("\n")
                .filter((line) => line !== "")
                .every((line) => line.startsWith("//")),
        ).toBe(true);
    });

    // An empty script really ships, and the reader refuses it rather than calling it a script with no blocks.
    it("says so for an empty file rather than failing the open", () => {
        expect(render(bcsFile(""), NAMING)).toContain("is empty");
    });

    it("maps the view document back to the file it renders", () => {
        expect(sourcePath({ path: "/games/bg2/data/AERIE.bcs.baf" })).toBe("/games/bg2/data/AERIE.bcs");
    });

    /**
     * The engine decides which IDS table names each of an object's enumerated fields, so the same stored
     * record reads differently per game. Torment's second field is FACTION where the BG family's is GENERAL.
     */
    it("names an object's fields by the open game's engine", () => {
        const script =
            'SC\nCR\nCO\nTR\n16412 0 0 0 0"" ""OB\n0 5 0 0 0 0 0 0 0 0 0 0 0 0 [-1.-1.-1.-1] ""OB\nTR\nCO\nRS\nRS\nCR\nSC\n';
        const symbols: BcsSymbols = {
            trigger: (id) => (id === 16412 ? ["See(O:Object*)"] : []),
            action: () => [],
            ids: (table) => (table === "FACTION" ? new Map([[5, "FACTION_MERCYKILLER"]]) : undefined),
        };

        const text = render(bcsFile(script), { symbols, engine: "pst" });

        expect(text.split("\n")[1]).toBe("  See([0.FACTION_MERCYKILLER])");
    });
});

/**
 * The install's detected script style IS the BCS engine axis, so the mapping is total and needs no fallback.
 * Both Baldur's Gate styles share one object layout and one set of naming tables, which is why they collapse.
 */
describe("the engine a game's script style names", () => {
    it("maps every script style the detector reports", () => {
        expect(bcsEngineForScriptStyle("bg1")).toBe("bg");
        expect(bcsEngineForScriptStyle("bg2")).toBe("bg");
        expect(bcsEngineForScriptStyle("iwd1")).toBe("iwd");
        expect(bcsEngineForScriptStyle("iwd2")).toBe("iwd2");
        expect(bcsEngineForScriptStyle("pst")).toBe("pst");
    });
});
