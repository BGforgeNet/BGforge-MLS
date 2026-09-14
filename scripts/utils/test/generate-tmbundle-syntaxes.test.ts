/**
 * Tests for generate-tmbundle-syntaxes: which grammars the TextMate bundle carries and the file types each claims.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundleGrammars, withFileTypes } from "../src/generate-tmbundle-syntaxes.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const contributes = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).contributes;
const byLanguage = new Map(bundleGrammars(contributes).map((g) => [g.language, g]));

describe("bundleGrammars against package.json", () => {
    it("carries each language's extensions without the dot", () => {
        expect(byLanguage.get("weidu-tp2")?.fileTypes).toStrictEqual(["tp2", "tpa", "tph", "tpp"]);
        expect(byLanguage.get("fallout-ssl")?.fileTypes).toStrictEqual(["ssl", "h"]);
    });

    it("carries whole file names", () => {
        expect(byLanguage.get("fallout-worldmap-txt")?.fileTypes).toStrictEqual(["worldmap.txt"]);
        expect(byLanguage.get("weidu-log")?.fileTypes).toStrictEqual(["weidu.log"]);
    });

    it("leaves .ssl to Fallout SSL and bundles SCS SSL with no file types", () => {
        expect(byLanguage.get("weidu-ssl")?.fileTypes).toStrictEqual([]);
    });

    it("bundles no grammar whose language maps no file, and every bundled grammar exists", () => {
        expect(
            [...byLanguage.keys()].filter((l) => l.endsWith("-tooltip") || l.startsWith("bgforge-mls-")),
        ).toStrictEqual([]);
        for (const g of byLanguage.values()) expect(fs.existsSync(path.join(REPO_ROOT, g.path)), g.path).toBe(true);
    });
});

describe("bundleGrammars on a shared file type", () => {
    it("names the file type and its claimants when no owner is declared", () => {
        expect(() =>
            bundleGrammars({
                languages: [
                    { id: "a", extensions: [".x"] },
                    { id: "b", extensions: [".x", ".y"] },
                ],
                grammars: [
                    { language: "a", path: "a.json" },
                    { language: "b", path: "b.json" },
                ],
            }),
        ).toThrow('"x" is declared by a and b; name the one that keeps it in SHARED_FILE_TYPE_OWNER');
    });
});

describe("withFileTypes", () => {
    it("sets the key, replacing one already there", () => {
        expect(withFileTypes({ scopeName: "source.t", fileTypes: ["old"] }, ["t"])).toStrictEqual({
            scopeName: "source.t",
            fileTypes: ["t"],
        });
    });

    it("omits the key when the grammar claims nothing", () => {
        expect(withFileTypes({ scopeName: "source.t" }, [])).toStrictEqual({ scopeName: "source.t" });
    });
});
