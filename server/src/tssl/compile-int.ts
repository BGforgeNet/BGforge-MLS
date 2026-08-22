/**
 * Compiles a TSSL document straight to Fallout bytecode.
 *
 * TSSL is a compiler, not a transpiler: the TypeScript AST becomes the INT intermediate representation
 * directly, so no SSL text is produced or parsed on the way and there is no generated file for a
 * diagnostic to be relocated from - a refusal already carries the line in the source the author has open.
 *
 * The readable SSL remains available behind `bgforge.tssl.emitSsl`, for a mod that still ships it or an
 * author who wants to read what their script became. It is written from the same source, not decompiled
 * from the bytecode, and `scripts/test-transpile-external.sh` byte-compares the two routes across a real
 * corpus at every optimisation level, so the file beside the bytecode does compile to those bytes.
 *
 * Nothing here compiles anything: the work runs on a worker thread, which is where the ts-morph project
 * it needs lives between compiles. This module decides only what to produce and where to put it.
 */

import { EXT_TSSL } from "../core/languages";
import { parseArgs } from "../../../compilers/ssl/src/args";
import { intOutputPath } from "../core/int-output-path";
import { compileOnWorker } from "./compile-worker-client";
import { abortAllCompiles, withCompileLifecycle } from "../core/compile-with-tmp-file";
import { normalizeUri } from "../core/normalized-uri";
import type { MLSsettings } from "../settings";

/**
 * In-flight compiles per document, so a save displaces the compile the previous one started rather
 * than queueing behind it. Same bookkeeping the Fallout SSL and WeiDU compilers keep, for the same
 * reason: the older answer would otherwise land after the newer one and win.
 */
const activeCompiles = new Map<ReturnType<typeof normalizeUri>, AbortController>();

/** Abort every in-flight TSSL compile. Called from server shutdown. */
export function abortInFlightTsslCompiles(): void {
    abortAllCompiles(activeCompiles);
}

export interface TsslCompileResult {
    /**
     * Where the bytecode goes. A validation run with `compileOnValidate` off compiles the same bytes
     * and keeps none, so this names the throwaway it would have been rather than a file on disk - only
     * an interactive compile, which always writes, reads this.
     */
    intPath: string;
    /** Where the readable SSL landed, when the setting asks for it. */
    sslPath?: string;
}

/**
 * Compiles `text` and writes the result, returning what it produced - or `null` when a newer compile
 * of the same document displaced this one, which is not a failure and has nothing to report. A refusal
 * from the front end propagates as the positioned `TranspileError` it already is.
 */
export async function compileTsslToInt(
    uri: string,
    filepath: string,
    text: string,
    settings: MLSsettings,
    interactive: boolean,
): Promise<TsslCompileResult | null> {
    // The optimisation switches come from the Fallout SSL compiler's own command line, because that
    // setting is what already decided how a `.tssl` was compiled when it went through generated SSL.
    // The rest of that line addresses an SSL text compiler - a preprocessor, a keyword set, an output
    // format - and names nothing a TypeScript source has, so it is not read here.
    const args = parseArgs(settings.falloutSSL.compileOptions.split(/\s+/).filter(Boolean));

    const written = interactive || settings.falloutSSL.compileOnValidate;
    const intPath = intOutputPath(filepath, settings.falloutSSL.outputDirectory, uri, written);
    const sslPath = settings.tssl.emitSsl ? filepath.slice(0, -EXT_TSSL.length) + ".ssl" : null;

    let completed = false;
    await withCompileLifecycle({
        uri: normalizeUri(uri),
        activeCompiles,
        run: async (signal) => {
            completed = await compileOnWorker(
                {
                    text,
                    filepath,
                    intPath: written ? intPath : null,
                    sslPath,
                    level: args.level,
                    shortCircuit: args.shortCircuit,
                },
                signal,
            );
        },
    });
    if (!completed) return null;

    return sslPath === null ? { intPath } : { intPath, sslPath };
}

// Prewarming on open - sending the document to the worker so its TypeScript program is standing before
// the author's first save - was built and dropped: opening a document already compiles it. The LSP
// document manager raises a content-change for a `didOpen`, so the debounced validation runs about
// 300 ms after the file appears, which is earlier than any save and pays exactly the same cost. Under a
// `bgforge.validate` that skips typing it would help, at the price of a second compile on open for
// everyone else.
