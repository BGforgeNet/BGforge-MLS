/**
 * Filesystem-backed pid -> subType resolver: scans `<base>/items/*.pro` and
 * `<base>/scenery/*.pro`, parses each header to lift the subType, and returns
 * a resolver. Used by callers (CLI, editor) to override the bundled vanilla
 * Fallout 2 table with whatever protos a mod tree ships alongside its maps.
 *
 * Filename convention is the Fallout 2 standard: 8-digit zero-padded decimal
 * objectId, e.g. `00000031.pro`. The full pid is `(pidType << 24) | objectId`
 * where pidType is 0 for items, 2 for scenery.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadProDirResolver, composePidResolvers } from "../src/pro-resolver-loader";
import { resolvePidSubType } from "../src/pid-resolver";

const FIXTURES = path.resolve("client/testFixture/proto");

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fgbin-proto-"));
    fs.mkdirSync(path.join(tmpDir, "items"));
    fs.mkdirSync(path.join(tmpDir, "scenery"));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function copyFixture(subdir: "items" | "scenery", name: string): void {
    fs.copyFileSync(path.join(FIXTURES, subdir, name), path.join(tmpDir, subdir, name));
}

describe("loadProDirResolver", () => {
    it("resolves an item pid (pidType=0) to its subType from a real .pro", () => {
        // items/00000031.pro is a vanilla ammo proto (subType 4 / Ammo).
        copyFixture("items", "00000031.pro");
        const { resolver } = loadProDirResolver(tmpDir);
        expect(resolver(31)).toBe(4);
    });

    it("resolves a scenery pid (pidType=2) to its subType from a real .pro", () => {
        // scenery/00000008.pro is a vanilla door proto (subType 0 / Door).
        copyFixture("scenery", "00000008.pro");
        const { resolver } = loadProDirResolver(tmpDir);
        const pid = (2 << 24) | 8;
        expect(resolver(pid)).toBe(0);
    });

    it("returns undefined for pids without a matching .pro file", () => {
        const { resolver } = loadProDirResolver(tmpDir);
        expect(resolver(0x02000999)).toBeUndefined();
    });

    it("returns undefined for pidTypes other than item/scenery", () => {
        copyFixture("items", "00000031.pro");
        const { resolver } = loadProDirResolver(tmpDir);
        // Critter pid (pidType=1) — loader only walks items/scenery dirs.
        expect(resolver(0x01000031)).toBeUndefined();
    });

    it("reports stats: filesScanned, subtypesResolved, errors, durationMs", () => {
        copyFixture("items", "00000031.pro");
        copyFixture("scenery", "00000008.pro");
        const { stats } = loadProDirResolver(tmpDir);
        expect(stats.filesScanned).toBe(2);
        expect(stats.subtypesResolved).toBe(2);
        expect(stats.errors).toEqual([]);
        expect(typeof stats.durationMs).toBe("number");
        expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("survives a missing items dir (scenery-only mod tree)", () => {
        fs.rmSync(path.join(tmpDir, "items"), { recursive: true });
        copyFixture("scenery", "00000008.pro");
        const { resolver, stats } = loadProDirResolver(tmpDir);
        expect(resolver(0x02000008)).toBe(0);
        expect(stats.filesScanned).toBe(1);
    });

    it("survives both subdirs missing (returns an empty resolver, no errors)", () => {
        fs.rmSync(path.join(tmpDir, "items"), { recursive: true });
        fs.rmSync(path.join(tmpDir, "scenery"), { recursive: true });
        const { resolver, stats } = loadProDirResolver(tmpDir);
        expect(resolver(31)).toBeUndefined();
        expect(stats.filesScanned).toBe(0);
        expect(stats.errors).toEqual([]);
    });

    it("ignores files whose name doesn't match `^\\d{8}\\.pro$`", () => {
        fs.writeFileSync(path.join(tmpDir, "items", "README.md"), "hi");
        fs.writeFileSync(path.join(tmpDir, "items", "garbage.pro"), "hi");
        fs.writeFileSync(path.join(tmpDir, "items", "1234.pro"), "short"); // wrong digit count
        const { stats } = loadProDirResolver(tmpDir);
        expect(stats.filesScanned).toBe(0);
        expect(stats.errors).toEqual([]);
    });

    it("collects errors for malformed .pro files but keeps going", () => {
        copyFixture("items", "00000031.pro");
        fs.writeFileSync(path.join(tmpDir, "items", "00000099.pro"), Buffer.from("xx"));
        const { resolver, stats } = loadProDirResolver(tmpDir);
        expect(resolver(31)).toBe(4); // good file still parsed
        expect(stats.subtypesResolved).toBe(1);
        expect(stats.errors).toHaveLength(1);
        expect(stats.errors[0]).toMatch(/00000099\.pro/);
    });

    it("ignores nested subdirectories (top-level only by design)", () => {
        fs.mkdirSync(path.join(tmpDir, "items", "subdir"));
        fs.copyFileSync(
            path.join(FIXTURES, "items", "00000031.pro"),
            path.join(tmpDir, "items", "subdir", "00000031.pro"),
        );
        const { stats } = loadProDirResolver(tmpDir);
        expect(stats.filesScanned).toBe(0);
    });
});

describe("composePidResolvers", () => {
    it("returns the first non-undefined result across resolvers", () => {
        const a = (pid: number) => (pid === 1 ? 11 : undefined);
        const b = (pid: number) => (pid === 1 ? 22 : pid === 2 ? 33 : undefined);
        const composed = composePidResolvers(a, b);
        expect(composed(1)).toBe(11);
        expect(composed(2)).toBe(33);
        expect(composed(3)).toBeUndefined();
    });

    it("composes overrides on top of the bundled defaults", () => {
        const overrides = (pid: number) => (pid === 1 ? 99 : undefined);
        const composed = composePidResolvers(overrides, resolvePidSubType);
        expect(composed(1)).toBe(99);
        // pid 161 is a vanilla weapon in the bundled table → subType 3.
        expect(composed(161)).toBe(3);
    });

    it("returns undefined when every resolver returns undefined", () => {
        const composed = composePidResolvers(
            () => undefined,
            () => undefined,
        );
        expect(composed(42)).toBeUndefined();
    });

    it("accepts a single resolver (degenerate case)", () => {
        const composed = composePidResolvers((pid) => (pid === 7 ? 5 : undefined));
        expect(composed(7)).toBe(5);
        expect(composed(8)).toBeUndefined();
    });
});
