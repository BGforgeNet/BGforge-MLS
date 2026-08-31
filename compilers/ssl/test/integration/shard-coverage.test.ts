/**
 * Guards the one thing sharding a sweep can break silently: a missing shard.
 *
 * Each shard asserts the full corpus size and then sweeps its own slice, so a shard that RUNS cannot
 * quietly measure less than it claims. A shard that is deleted, renamed, or never committed is the gap -
 * the survivors all pass, the suite is green, and a fraction of the corpus is simply never swept. That is
 * the failure `corpus.ts` calls "a comparison that quietly shrank", reached by a route no assertion
 * inside a sweep can see. The check itself, and its own tests, live in the shared helper.
 */

import { describe, expect, it } from "vitest";
import { shardSetProblems } from "../../../../shared/cli/test/shard.ts";

describe("sharded sweeps", () => {
    it("has every shard each sweep declares", () => {
        expect(shardSetProblems(import.meta.dirname)).toEqual([]);
    });
});
