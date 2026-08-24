import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BcsSymbols } from "../../compilers/bcs/src/index";
import { render, sourcePath } from "../src/bcs-editor/document";

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

describe("the decompiled view of a .bcs", () => {
    it("decompiles the script when the document has a game behind it", () => {
        const text = render(bcsFile(SCRIPT), SYMBOLS);

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
        expect(render(bcsFile(""), SYMBOLS)).toContain("is empty");
    });

    it("maps the view document back to the file it renders", () => {
        expect(sourcePath({ path: "/games/bg2/data/AERIE.bcs.baf" })).toBe("/games/bg2/data/AERIE.bcs");
    });
});
