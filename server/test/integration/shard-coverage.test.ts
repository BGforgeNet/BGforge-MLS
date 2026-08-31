/**
 * Guards the one thing sharding a sweep can break silently: a missing shard.
 *
 * A shard that RUNS asserts the full population before slicing it, so it cannot quietly measure less than
 * it claims. A shard that is deleted, renamed, or never committed is the gap - the survivors all pass,
 * the suite is green, and a fraction of the corpus is simply never swept. The check itself, and its own
 * tests, live in the shared helper.
 */

import { describe, expect, it } from "vitest";
import { shardSetProblems } from "../../../shared/cli/test/shard.ts";

describe("sharded sweeps", () => {
    it("has every shard each sweep declares", () => {
        expect(shardSetProblems(import.meta.dirname)).toEqual([]);
    });
});
