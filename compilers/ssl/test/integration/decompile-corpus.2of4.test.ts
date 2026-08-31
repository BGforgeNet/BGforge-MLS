// Shard 2 of the decompile sweep; the sweep and its assertions live in decompile-corpus.sweep.ts,
// and shard-coverage.test.ts checks that every shard this naming declares is present.
import { registerDecompileShard } from "./decompile-corpus.sweep.ts";

registerDecompileShard(2, 4);
