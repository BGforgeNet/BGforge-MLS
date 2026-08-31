// Shard 1 of the compile sweep; the sweep and its assertions live in compile-corpus.sweep.ts,
// and shard-coverage.test.ts checks that every shard this naming declares is present.
import { registerCompileShard } from "./compile-corpus.sweep.ts";

registerCompileShard(1, 2);
