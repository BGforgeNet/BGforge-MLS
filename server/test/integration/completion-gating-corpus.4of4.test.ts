// Shard 4 of the completion-gate corpus sweep; the sweep and its assertions live in
// completion-gating-corpus.sweep.ts, and shard-coverage.test.ts checks every declared shard is present.
import { registerCompletionGateShard } from "./completion-gating-corpus.sweep.ts";

registerCompletionGateShard(4, 4);
