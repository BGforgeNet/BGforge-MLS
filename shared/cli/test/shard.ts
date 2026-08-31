/**
 * Splitting a corpus sweep across several test FILES, and the guard that split makes necessary.
 *
 * Vitest schedules FILES, not tests, so a sweep written as one `it` around a serial loop over a corpus
 * occupies a single core however large the worker pool is - and the suite's wall time is then just its
 * longest file. Measured before this split: one SSL sweep took 99.8s of a 100.5s suite while the suite
 * used 3.2 of 10 cores, and one server sweep took 60.5s of 62.3s. Slicing the file list across thin
 * per-shard files is what lets the pool spread the work.
 *
 * Sharding costs nothing in coverage as long as every shard is present: each one still lists the WHOLE
 * population and asserts its size before taking a slice, so a corpus that shrank mid-checkout fails
 * inside every shard. What a shard cannot notice is its own ABSENCE - delete one of four and the other
 * three pass while a quarter of the corpus is never swept, which is the silent shrinkage these sweeps are
 * built to prevent, reached by a route no assertion inside one can see. `shardSetProblems` is that check.
 */

import * as fs from "node:fs";

/**
 * Shard `index` of `count`, 1-based: every `count`-th item, not a contiguous block.
 *
 * A stride because these corpora are SORTED BY PATH and cost is not spread evenly along that order - one
 * mod's files sit together, and a big mod is a run of big files. Contiguous slices of the Infinity Engine
 * corpus measured 55.6s, 7.8s, 3.5s and 3.5s: one shard did essentially all the work and the split bought
 * nothing. Interleaving hands each shard the same mix. Both forms tile the input exactly - every item in
 * exactly one shard - so this is a scheduling choice, not a coverage one.
 */
export function shardScripts<T>(all: readonly T[], index: number, count: number): T[] {
    return all.filter((_, at) => at % count === index - 1);
}

/** `<sweep>.<index>of<count>.test.ts` - the naming every sharded sweep uses. */
const SHARD_FILE = /^(?<sweep>.+)\.(?<index>\d+)of(?<count>\d+)\.test\.ts$/;

/**
 * What is wrong with the set of shard files in `dirname`, as a list of human-readable problems; empty
 * means the set is complete. Read off the directory rather than a list kept by hand, because a hand list
 * is one more thing to forget to update and forgetting it fails in the same invisible direction.
 */
export function shardSetProblems(dirname: string): string[] {
    const shards = fs
        .readdirSync(dirname)
        .map((name) => SHARD_FILE.exec(name))
        .filter((match) => match !== null)
        .map((match) => ({
            sweep: match.groups!["sweep"]!,
            index: Number(match.groups!["index"]),
            count: Number(match.groups!["count"]),
        }));

    const problems: string[] = [];
    // No shard files at all means either this directory has none - which its caller knows and asserts -
    // or the naming changed and every sharded sweep silently stopped being checked here.
    if (shards.length === 0) return ["no shard files found; has the <sweep>.<i>of<n>.test.ts naming changed?"];

    for (const sweep of [...new Set(shards.map((shard) => shard.sweep))].toSorted()) {
        const mine = shards.filter((shard) => shard.sweep === sweep);
        const counts = [...new Set(mine.map((shard) => shard.count))].toSorted((a, b) => a - b);
        if (counts.length > 1) {
            // One shard saying "of 4" while its siblings say "of 3" means a split was half-renamed, and
            // the slices then neither tile nor overlap predictably.
            problems.push(`${sweep}: shard files disagree on the count (${counts.join(", ")})`);
            continue;
        }
        const count = counts[0]!;
        const indices = mine.map((shard) => shard.index).toSorted((a, b) => a - b);
        const expected = Array.from({ length: count }, (_, i) => i + 1);
        if (indices.join(",") !== expected.join(",")) {
            // `indices` is never empty: this sweep name exists only because a file produced it.
            problems.push(`${sweep}: expected shards 1..${count}, found ${indices.join(", ")}`);
        }
    }
    return problems;
}
