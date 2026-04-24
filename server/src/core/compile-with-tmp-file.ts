/**
 * Shared lifecycle helper for compile flows that write a temporary source file,
 * spawn a compiler, and clean up the tmp file(s) afterward.
 *
 * Invariants this helper enforces for every caller:
 *  - activeCompiles: stale in-flight compilations for the same URI are aborted
 *    before a new one starts; the AbortController is registered and removed.
 *  - The tmp file is written before `run` starts and deleted in a finally block,
 *    regardless of whether `run` resolves, rejects, or is aborted.
 *  - Additional cleanup paths (e.g., a throwaway validation .int output) are
 *    deleted in the same finally block.
 *
 * The caller owns: parsing compiler output, sending diagnostics, and
 * interpreting `signal.aborted` to skip stale results.
 */

import * as fs from "fs";
import { removeTmpFile } from "../common";
import type { NormalizedUri } from "./normalized-uri";

interface CompileWithTmpFileParams {
    /** Normalized URI of the source document being compiled. Used as activeCompiles key. */
    uri: NormalizedUri;
    /** Absolute filesystem path where `text` is written before `run`. */
    tmpPath: string;
    /** Document text to write. */
    text: string;
    /** Map of in-flight controllers, shared across compile calls for the same compiler. */
    activeCompiles: Map<NormalizedUri, AbortController>;
    /** Additional paths to unlink in the finally block (e.g. throwaway compiler outputs). */
    extraCleanupPaths?: readonly string[];
    /** Caller-supplied compile body. Receives the cancellation signal of this run. */
    run: (signal: AbortSignal) => Promise<void>;
}

export async function compileWithTmpFile(params: CompileWithTmpFileParams): Promise<void> {
    const { uri, tmpPath, text, activeCompiles, extraCleanupPaths, run } = params;

    activeCompiles.get(uri)?.abort();
    const controller = new AbortController();
    activeCompiles.set(uri, controller);

    try {
        await fs.promises.writeFile(tmpPath, text);
        await run(controller.signal);
    } finally {
        activeCompiles.delete(uri);
        await removeTmpFile(tmpPath);
        if (extraCleanupPaths) {
            await Promise.all(extraCleanupPaths.map((extra) => removeTmpFile(extra)));
        }
    }
}
