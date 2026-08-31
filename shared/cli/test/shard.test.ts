import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { shardScripts, shardSetProblems } from "./shard.ts";

describe("shardScripts", () => {
    // The property the sweeps rest on: a shard boundary that dropped or repeated an item would move every
    // count they assert, in the direction that still looks plausible.
    it.each([
        [1553, 4],
        [1553, 3],
        [1553, 2],
        [12, 4],
        [3, 4],
        [1, 1],
        [0, 3],
    ])("tiles %d items across %d shards exactly", (length, count) => {
        const all = Array.from({ length }, (_, i) => i);
        const slices = Array.from({ length: count }, (_, i) => shardScripts(all, i + 1, count));
        expect(slices.flat().toSorted((a, b) => a - b)).toEqual(all);
        // Sizes within one of each other, which is what makes the shards interchangeable in the pool.
        const sizes = slices.map((slice) => slice.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    });

    // Interleaved, not contiguous: a run of expensive neighbours must land in different shards, which is
    // the whole reason for the stride.
    it("interleaves rather than blocking", () => {
        const all = Array.from({ length: 10 }, (_, i) => i);
        expect(shardScripts(all, 1, 3)).toEqual([0, 3, 6, 9]);
        expect(shardScripts(all, 2, 3)).toEqual([1, 4, 7]);
        expect(shardScripts(all, 3, 3)).toEqual([2, 5, 8]);
    });
});

describe("shardSetProblems", () => {
    // A real directory, because the function's whole job is to read one; fixtures cannot live under a
    // test/ tree here, where a file named `*.test.ts` would be collected as a suite of its own.
    const dirs: string[] = [];
    const withFiles = (...names: string[]): string => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shard-set-"));
        dirs.push(dir);
        for (const name of names) fs.writeFileSync(path.join(dir, name), "");
        return dir;
    };

    afterEach(() => {
        for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    });

    it("accepts a complete set", () => {
        const dir = withFiles("sweep.1of3.test.ts", "sweep.2of3.test.ts", "sweep.3of3.test.ts", "other.ts");
        expect(shardSetProblems(dir)).toEqual([]);
    });

    it("accepts several sweeps sharded to different counts", () => {
        const dir = withFiles("a.1of2.test.ts", "a.2of2.test.ts", "b.1of1.test.ts");
        expect(shardSetProblems(dir)).toEqual([]);
    });

    it("names the sweep and the gap when a shard is missing", () => {
        const dir = withFiles("sweep.1of3.test.ts", "sweep.3of3.test.ts");
        expect(shardSetProblems(dir)).toEqual(["sweep: expected shards 1..3, found 1, 3"]);
    });

    it("catches a half-renamed split, where the shards disagree on the count", () => {
        const dir = withFiles("sweep.1of3.test.ts", "sweep.2of3.test.ts", "sweep.3of4.test.ts");
        expect(shardSetProblems(dir)).toEqual(["sweep: shard files disagree on the count (3, 4)"]);
    });

    // Without this the guard is vacuously green wherever the naming drifts: nothing matches, no sweeps,
    // nothing to check.
    it("reports a directory with no shard files at all", () => {
        const dir = withFiles("plain.test.ts");
        expect(shardSetProblems(dir)).toEqual([
            "no shard files found; has the <sweep>.<i>of<n>.test.ts naming changed?",
        ]);
    });
});
