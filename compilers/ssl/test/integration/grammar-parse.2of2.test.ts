// Shard 2 of the grammar parse sweep; the sweep and its assertions live in grammar-parse.sweep.ts,
// and shard-coverage.test.ts checks that every shard this naming declares is present.
import { registerGrammarParseShard } from "./grammar-parse.sweep.ts";

registerGrammarParseShard(2, 2);
