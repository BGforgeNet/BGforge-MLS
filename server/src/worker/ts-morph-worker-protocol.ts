/**
 * The union the shared ts-morph worker dispatches on.
 *
 * Each side keeps its own protocol next to its own code - this only names the sum, so that the entry
 * point can be one file. `kind` is what discriminates them: the transpile side already had one for its
 * four request types, and the compile side gained `"compile"` when the bundles merged.
 */

import type { CompileRequest, CompileResponse } from "../tssl/compile-worker-protocol";
import type { TranspileRequest, TranspileResponse } from "../transpile/transpile-worker-protocol";

export type WorkerRequest = CompileRequest | TranspileRequest;
export type WorkerResponse = CompileResponse | TranspileResponse;
