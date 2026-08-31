// Shard 1 of the optimise sweep; the sweep and its assertions live in optimize-corpus.sweep.ts,
// and shard-coverage.test.ts checks that every shard this naming declares is present.
import { registerOptimizeShard } from "./optimize-corpus.sweep.ts";

registerOptimizeShard(1, 3);
