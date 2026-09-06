/**
 * `resolveExisting`'s case-insensitive path walk: it must still match a differently-cased path, and it
 * must give up once the directories it reads exceed FILENAME_SEARCH_BUDGET rather than scanning a huge
 * tree synchronously on a definition request.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { resolveExisting, FILENAME_SEARCH_BUDGET } from "../../src/shared/path-definition";

let root: string;
let narrowDir: string;
let wideDir: string;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "path-definition-"));
    narrowDir = path.join(root, "Narrow");
    wideDir = path.join(root, "Wide");
    fs.mkdirSync(narrowDir);
    fs.mkdirSync(wideDir);
    fs.writeFileSync(path.join(narrowDir, "Target.txt"), "");
    fs.writeFileSync(path.join(wideDir, "Target.txt"), "");
    // One entry past the budget, so the walk's own cap is what stops it rather than the handful of
    // entries the enclosing temp directories contribute.
    for (let i = 0; i < FILENAME_SEARCH_BUDGET; i++) {
        fs.writeFileSync(path.join(wideDir, `filler-${i}.txt`), "");
    }
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("resolveExisting", () => {
    it("returns the path unchanged when it already exists", () => {
        const exact = path.join(narrowDir, "Target.txt");
        expect(resolveExisting(exact)).toBe(exact);
    });

    it("matches each segment case-insensitively", () => {
        expect(resolveExisting(path.join(root, "narrow", "target.TXT"))).toBe(path.join(narrowDir, "Target.txt"));
    });

    it("returns null once the walk exceeds the entry budget", () => {
        expect(resolveExisting(path.join(root, "wide", "target.TXT"))).toBeNull();
    });

    it("returns null when no case-insensitive match exists", () => {
        expect(resolveExisting(path.join(narrowDir, "missing.txt"))).toBeNull();
    });
});
