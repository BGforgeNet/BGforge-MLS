/**
 * Go-to-definition / Ctrl+Click for the file paths in WeiDU TP2 COPY / COMPILE / INCLUDE directives.
 * Exercised through the public `getDefinition` entry point.
 *
 * `classify` reports the outcome: the target file's basename, `self@<line>` when the result points back
 * into the same document (a heredoc block, or the authoritative no-op that suppresses the handler's
 * wrong-jump fallback), or `NULL` when the cursor is not on a file-directive path at all.
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { pathToFileURL, fileURLToPath } from "url";
import type { Location, Position } from "vscode-languageserver/node";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { getDefinition } from "../../src/weidu-tp2/definition";
import { initParser } from "../../../shared/parsers/weidu-tp2";
import { parseFile } from "../../src/weidu-tp2/header-parser";
import { Symbols } from "../../src/core/symbol-index";
import { normalizeUri } from "../../src/core/normalized-uri";

beforeAll(async () => {
    await initParser();
});

/** Outcome of a definition result relative to the document it was requested in. */
function classify(result: Location | null, docUri: string): string {
    if (result === null) {
        return "NULL";
    }
    return result.uri === docUri ? `self@${result.range.start.line}` : path.basename(fileURLToPath(result.uri));
}

describe("TP2 definition: COPY/COMPILE file navigation", () => {
    // Realistic layout: <gameDir>/mymod/mymod.tp2 - tp2 INSIDE the mod folder (WeiDU branch 2).
    let gameDir: string;
    let tp2Uri: string;

    beforeEach(() => {
        gameDir = fs.mkdtempSync(path.join(os.tmpdir(), "tp2-nav-"));
        const tp2Path = path.join(gameDir, "mymod", "mymod.tp2");
        fs.mkdirSync(path.dirname(tp2Path), { recursive: true });
        fs.writeFileSync(tp2Path, "// mod");
        tp2Uri = pathToFileURL(tp2Path).toString();
    });

    afterEach(() => {
        fs.rmSync(gameDir, { recursive: true, force: true });
    });

    /** Create a file under the game dir; returns its absolute path. */
    function write(rel: string, content = ""): string {
        const f = path.join(gameDir, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, content);
        return f;
    }
    /** Position on the first character of `needle` in single-line `text`. */
    const at = (text: string, needle: string): Position => ({ line: 0, character: text.indexOf(needle) });
    const outcome = (text: string, needle: string): string =>
        classify(getDefinition(text, tp2Uri, at(text, needle)), tp2Uri);

    it("navigates a COPY from-path to an existing .itm", () => {
        write("mymod/items/sword.itm", "ITM V1  ");
        expect(outcome(`COPY ~mymod/items/sword.itm~ ~override~`, "items")).toBe("sword.itm");
    });

    it("resolves %MOD_FOLDER% against the mod root", () => {
        write("mymod/items/sword.itm");
        expect(outcome(`COPY ~%MOD_FOLDER%/items/sword.itm~ ~override~`, "items")).toBe("sword.itm");
    });

    it("navigates a .bmp (image preview is displayable)", () => {
        write("mymod/gui/portrait.bmp");
        expect(outcome(`COPY ~mymod/gui/portrait.bmp~ ~override~`, "portrait.bmp")).toBe("portrait.bmp");
    });

    it("navigates a COMPILE source .baf file", () => {
        write("mymod/baf/script.baf", "IF ~~ THEN END");
        expect(outcome(`COMPILE ~mymod/baf/script.baf~`, "script.baf")).toBe("script.baf");
    });

    it("resolves a variable-prefixed path by its unique basename (filename-first)", () => {
        // %custom_dir% is an unresolvable user variable, but sword.itm is unique in the mod.
        write("mymod/items/sword.itm");
        expect(outcome(`COPY ~%custom_dir%/sword.itm~ ~override~`, "sword.itm")).toBe("sword.itm");
    });

    it("does NOT guess when the basename is ambiguous (two matches -> no-op)", () => {
        write("mymod/a/dup.itm");
        write("mymod/b/dup.itm");
        expect(outcome(`COPY ~%custom_dir%/dup.itm~ ~override~`, "dup.itm")).toBe("self@0");
    });

    it("does NOT navigate the COPY destination (to field), staying put instead of jumping", () => {
        write("mymod/items/sword.itm");
        write("override/sword.itm"); // exists, so a naive resolver could wrongly jump
        expect(outcome(`COPY ~mymod/items/sword.itm~ ~override/sword.itm~`, "override/sword.itm")).toBe("self@0");
    });

    it("does not navigate a COPY_EXISTING source (game resref), staying put", () => {
        write("mymod/sword.itm");
        expect(outcome(`COPY_EXISTING ~sword.itm~ ~override~`, "sword.itm")).toBe("self@0");
    });

    it("stays put for a displayable-but-absent file", () => {
        expect(outcome(`COPY ~mymod/items/missing.itm~ ~override~`, "missing.itm")).toBe("self@0");
    });

    it("does not navigate an opaque binary type (.bam), even if present", () => {
        write("mymod/gui/anim.bam");
        expect(outcome(`COPY ~mymod/gui/anim.bam~ ~override~`, "anim.bam")).toBe("self@0");
    });

    it("prefers a same-file heredoc block over a same-named file (WeiDU precedence)", () => {
        write("mymod/inline/patch.baf", "ON DISK"); // real file that also matches
        const text = [
            `<<<<<<<< mymod/inline/patch.baf`,
            `IF ~~ THEN END`,
            `>>>>>>>>`,
            `COMPILE ~mymod/inline/patch.baf~`,
        ].join("\n");
        // The block is on line 0, not the on-disk .baf.
        expect(classify(getDefinition(text, tp2Uri, { line: 3, character: 12 }), tp2Uri)).toBe("self@0");
    });
});

describe("TP2 definition: heredoc inline-file navigation", () => {
    const uri = "file:///nonexistent/mymod/mymod.tp2";

    it("jumps to the <<<< block for a same-file heredoc reference (no filesystem needed)", () => {
        const text = [`<<<<<<<< inline/patch.baf`, `IF ~~ THEN END`, `>>>>>>>>`, `COMPILE ~inline/patch.baf~`].join(
            "\n",
        );
        expect(classify(getDefinition(text, uri, { line: 3, character: 14 }), uri)).toBe("self@0");
    });

    it("stays put (authoritative no-op) when the label has no <<<< block and no file", () => {
        const text = `COMPILE ~inline/undefined.baf~`;
        expect(classify(getDefinition(text, uri, { line: 0, character: 14 }), uri)).toBe("self@0");
    });
});

describe("TP2 definition: path strings own the click (no wrong-jump to a same-named function)", () => {
    // The definition handler falls back to a bare-word symbol lookup when the provider returns null,
    // which would wrongly jump a path filename to a same-named DEFINE_ACTION_FUNCTION. The provider must
    // be AUTHORITATIVE for path strings - return non-null - so the handler never reaches that fallback.
    // Reproduced with the function indexed, as the live provider passes it (fileIndex.symbols).
    const uri = "file:///nonexistent/mymod/mymod.tp2";

    const indexOf = (text: string): Symbols => {
        const symbols = new Symbols();
        symbols.updateFile(normalizeUri(uri), [...parseFile(uri, text).symbols]);
        return symbols;
    };

    it("returns an authoritative result for an INCLUDE filename, never the same-named function", () => {
        const text = [
            `DEFINE_ACTION_FUNCTION balthazar_monk_resources BEGIN`,
            `END`,
            `INCLUDE ~%balth_loc%/balthazar_monk_resources.tpa~`,
        ].join("\n");
        const col = text.split("\n")[2]!.indexOf("balthazar_monk_resources") + 3;
        const result = getDefinition(text, uri, { line: 2, character: col }, indexOf(text));
        // Non-null (so the handler's symbol fallback never runs) and NOT the function on line 0.
        expect(result).not.toBeNull();
        expect(classify(result, uri)).toBe("self@2");
    });

    it("returns an authoritative result for a COPY from-filename, never the same-named function", () => {
        const text = [`DEFINE_ACTION_FUNCTION patch_item BEGIN`, `END`, `COPY ~%data%/patch_item.itm~ ~override~`].join(
            "\n",
        );
        const col = text.split("\n")[2]!.indexOf("patch_item.itm") + 3;
        const result = getDefinition(text, uri, { line: 2, character: col }, indexOf(text));
        expect(result).not.toBeNull();
        expect(classify(result, uri)).toBe("self@2");
    });
});

describe("TP2 definition: a %LANGUAGE% translation path resolves through the configured tra directory", () => {
    // A `%LANGUAGE%`-parameterised .tra reference has no static path, and its basename exists once per
    // language directory - so the unique-match rule above declines rather than pick one. The workspace has
    // already named a language directory for `@N` resolution (`mls.translation.directory` in .bgforge.yml);
    // navigation reads that same setting instead of guessing, and declines when it is not set.
    let gameDir: string;
    let tp2Uri: string;

    beforeEach(() => {
        gameDir = fs.mkdtempSync(path.join(os.tmpdir(), "tp2-lang-"));
        const tp2Path = path.join(gameDir, "mymod", "mymod.tp2");
        fs.mkdirSync(path.dirname(tp2Path), { recursive: true });
        fs.writeFileSync(tp2Path, "// mod");
        tp2Uri = pathToFileURL(tp2Path).toString();
    });

    afterEach(() => {
        fs.rmSync(gameDir, { recursive: true, force: true });
    });

    function write(rel: string, content = ""): string {
        const f = path.join(gameDir, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, content);
        return f;
    }
    const englishDir = (): string => path.join(gameDir, "mymod", "tra", "english");
    const at = (text: string, needle: string): Position => ({ line: 0, character: text.indexOf(needle) });
    const outcome = (text: string, needle: string, traDir?: string): string =>
        classify(getDefinition(text, tp2Uri, at(text, needle), undefined, traDir), tp2Uri);

    const TEXT = `COMPILE ~mymod/dlg/x#npc.d~ USING ~mymod/tra/%LANGUAGE%/x#npc.tra~`;

    beforeEach(() => {
        write("mymod/tra/english/x#npc.tra", "@1 = ~hello~");
        write("mymod/tra/french/x#npc.tra", "@1 = ~bonjour~");
    });

    it("jumps into the configured language directory", () => {
        const result = getDefinition(TEXT, tp2Uri, at(TEXT, "x#npc.tra"), undefined, englishDir());

        expect(result).not.toBeNull();
        expect(fileURLToPath(result!.uri)).toBe(path.join(englishDir(), "x#npc.tra"));
    });

    it("stays put when no tra directory is configured", () => {
        expect(outcome(TEXT, "x#npc.tra")).toBe("self@0");
    });

    it("stays put when the configured directory does not hold that file", () => {
        expect(outcome(TEXT, "x#npc.tra", path.join(gameDir, "mymod", "tra", "german"))).toBe("self@0");
    });

    // The setting names the TRANSLATION directory, so it licenses resolving a .tra/.msg reference and
    // nothing else: a variable-pathed .d stays ambiguous rather than being redirected there.
    it("does not redirect a non-translation reference", () => {
        write("mymod/dlg/a/x#dup.d");
        write("mymod/dlg/b/x#dup.d");
        const text = `COMPILE ~%custom%/x#dup.d~`;

        expect(outcome(text, "x#dup.d", englishDir())).toBe("self@0");
    });

    // A literal path is resolved on its own terms; a missing file must not silently become the tra dir's
    // same-named one, which would send a click on the french path into english.
    it("does not redirect a literal path that simply does not exist", () => {
        const text = `COMPILE ~mymod/tra/german/x#npc.tra~`;

        expect(outcome(text, "x#npc.tra", englishDir())).toBe("self@0");
    });
});
