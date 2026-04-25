/**
 * Shared transpiler pipeline factory.
 *
 * Eliminates duplicated orchestration across TSSL/TBAF/TD transpilers:
 * - Extension validation
 * - @tra tag extraction before bundling
 * - compile(): fileURLToPath, write output to disk, return structured events
 * - transpile(): thin wrapper around core pipeline
 *
 * Language-specific logic (bundling, IR, transformation, emission) stays
 * in each transpiler's transpileCore implementation.
 */

import { promises as fsp } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { extractTraTag } from "./transpiler-utils";
import { TranspileError } from "./transpile-error";

/**
 * Configuration for a transpiler instance.
 * @template TResult The type returned by transpileCore (string for TBAF, richer for TD/TSSL)
 * @template TExtra Optional per-call payload threaded through compile/transpile to transpileCore.
 *   Defaults to void for transpilers that need no extra state. TSSL uses this to pass an
 *   optional batch state (shared ts-morph Project + caches) when the CLI walks a directory.
 */
interface TranspilerConfig<TResult, TExtra = void> {
    /** File extension this transpiler handles, including dot (e.g., ".tbaf") */
    readonly sourceExtension: string;
    /** Target extension for compile output, including dot (e.g., ".baf") */
    readonly targetExtension: string;
    /** Human-readable name for log messages */
    readonly name: string;

    /**
     * Core transpilation: source text to output.
     * Receives the pre-extracted @tra tag (undefined if absent).
     * @param filePath Absolute file path
     * @param text Source text content
     * @param traTag Extracted @tra tag or undefined
     * @param extra Per-call payload (the value passed to compile/transpile, or undefined for TExtra=void)
     */
    transpileCore(filePath: string, text: string, traTag: string | undefined, extra: TExtra): Promise<TResult>;

    /** Extract the output string from the result. Identity for string results. */
    getOutput(result: TResult): string;
}

/**
 * Conditional rest-tuple: when TExtra is void, callers pass no extra arg;
 * otherwise the extra arg is required. Keeps TBAF/TD signatures clean while
 * letting TSSL thread its batch state through.
 */
type ExtraArgs<TExtra> = [TExtra] extends [void] ? [] : [extra: TExtra];

export interface TranspilerEvent {
    readonly level: "info";
    readonly code: "output_written";
    readonly message: string;
    readonly outPath: string;
}

/** Result from compile(), including the output path and the full transpiler result. */
interface CompileOutput<TResult> {
    /** Absolute path to the written output file */
    readonly outPath: string;
    /** The full transpiler result (may contain warnings, etc.) */
    readonly result: TResult;
    /** Structured events emitted during compilation. */
    readonly events: readonly TranspilerEvent[];
}

/**
 * Create compile() and transpile() functions from a transpiler config.
 * Handles the shared orchestration: validation, @tra extraction, file I/O, events.
 */
export function createTranspiler<TResult, TExtra = void>(config: TranspilerConfig<TResult, TExtra>) {
    function validateExtension(filePath: string): void {
        const ext = path.extname(filePath).toLowerCase();
        if (ext !== config.sourceExtension) {
            throw new Error(`${filePath} is not a ${config.sourceExtension} file`);
        }
    }

    return {
        /**
         * Compile: transpile and write output to disk.
         * Used by the LSP compile handler.
         */
        async compile(uri: string, text: string, ...extraArgs: ExtraArgs<TExtra>): Promise<CompileOutput<TResult>> {
            const filePath = fileURLToPath(uri);
            validateExtension(filePath);

            // For TExtra=void, no arg is passed; coerce to undefined for the core call.
            const extra = extraArgs[0] as TExtra | undefined as TExtra;
            const traTag = extractTraTag(text);
            let result: TResult;
            try {
                result = await config.transpileCore(filePath, text, traTag, extra);
            } catch (e) {
                throw TranspileError.wrap(e, { file: filePath });
            }
            const output = config.getOutput(result);

            const lowerPath = filePath.toLowerCase();
            const outPath = lowerPath.endsWith(config.sourceExtension)
                ? filePath.slice(0, -config.sourceExtension.length) + config.targetExtension
                : filePath + config.targetExtension;
            await fsp.writeFile(outPath, output, "utf-8");

            return {
                outPath,
                result,
                events: [
                    {
                        level: "info",
                        code: "output_written",
                        message: `Transpiled to ${outPath}`,
                        outPath,
                    },
                ],
            };
        },

        /**
         * Transpile: return the result without writing to disk.
         * Used by the CLI where the caller controls file I/O.
         */
        async transpile(filePath: string, text: string, ...extraArgs: ExtraArgs<TExtra>): Promise<TResult> {
            validateExtension(filePath);
            const extra = extraArgs[0] as TExtra | undefined as TExtra;
            const traTag = extractTraTag(text);
            try {
                return await config.transpileCore(filePath, text, traTag, extra);
            } catch (e) {
                throw TranspileError.wrap(e, { file: filePath });
            }
        },
    };
}
