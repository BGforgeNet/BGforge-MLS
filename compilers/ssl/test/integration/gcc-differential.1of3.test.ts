// Shard 1 of the gcc preprocessor differential; the sweep and its assertions live in
// gcc-differential.sweep.ts, and shard-coverage.test.ts checks every declared shard is present.
import { registerGccShard } from "./gcc-differential.sweep.ts";

registerGccShard(1, 3);
