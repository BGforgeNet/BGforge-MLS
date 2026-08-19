/**
 * The SSL compilation pipeline: source text to INT bytecode.
 *
 * Three stages, each usable on its own: the C preprocessor (`preprocess`), the shared tree-sitter
 * grammar, and lowering plus emission. The parser is supplied by the caller rather than constructed
 * here, because loading the grammar is asynchronous and callers - the language server, a CLI, a test -
 * already own a parser they should reuse.
 */

import * as path from "node:path";
import type { Parser } from "web-tree-sitter";
import { collectParseErrors } from "../../../shared/parse-errors";
import { CompileError } from "./compile-error";
import { EmitError, emitInt, type EmitOptions } from "./int/emit";
import type { Program } from "./int/ir";
import { LowerError, lowerProgram, type LowerOptions } from "./lower";
import { optimize, type OptimizeOptions } from "./optimize";
import { preprocessWithOrigins, type PreprocessedSource, type PreprocessOptions } from "./preprocess";
import { problemsOf } from "./problems";

export { CompileError, type CompileDiagnostic } from "./compile-error";

export interface CompileOptions extends LowerOptions, EmitOptions, OptimizeOptions {
    preprocess?: PreprocessOptions;
}

/**
 * Parses and optimises already-preprocessed source text, stopping before emission.
 *
 * Separate from `compileText` for the callers that want the program itself: the CLI prints it for `-D`,
 * and a test can assert on it without decoding bytes.
 */
export function buildProgram(parser: Parser, text: string, options: CompileOptions = {}): Program {
    const tree = parser.parse(text);
    if (tree === null) throw new CompileError([{ line: 1, column: 1, message: "parser returned no tree" }]);
    try {
        // A tree-sitter parse always succeeds, standing in ERROR and MISSING nodes for whatever did not
        // fit the grammar. Lowering walks past those without complaint and emits a program built from
        // the fragments it did understand, so the refusal has to happen here: a script the parser could
        // not read must not silently produce a compiled file that does something else.
        //
        // Every one of them is reported rather than only the first: they are already all in hand, and a
        // script with four syntax errors otherwise costs four compile-and-read cycles to clean up.
        const errors = collectParseErrors(tree.rootNode);
        if (errors.length > 0) {
            throw new CompileError(
                errors.map((error) => ({
                    line: error.startPosition.row + 1,
                    column: error.startPosition.column + 1,
                    message: error.isMissing ? `missing ${error.type}` : "syntax error",
                })),
            );
        }
        return optimize(lowerProgram(tree, options), options);
    } finally {
        tree.delete();
    }
}

/** Emits INT bytecode for a program `buildProgram` produced under the same options. */
export function emitProgram(program: Program, options: CompileOptions = {}): Uint8Array {
    return emitInt(program, {
        ...options,
        // A `#pragma sce` in the source asks for short-circuit evaluation as the command-line switch does,
        // so either turns it on.
        shortCircuit: options.shortCircuit === true || program.shortCircuit === true,
        // The optimiser removes the code that would reach a fall-through epilogue, so the emitter stops
        // writing one at the level where that removal happens.
        dropUnreachableEpilogue: (options.level ?? 0) >= 2,
    });
}

/** Compiles already-preprocessed source text. */
export function compileText(parser: Parser, text: string, options: CompileOptions = {}): Uint8Array {
    return emitProgram(buildProgram(parser, text, options), options);
}

/** Compiles a source file, running the preprocessor first. Diagnostics arrive in source coordinates. */
export function compileFile(parser: Parser, file: string, options: CompileOptions = {}): Uint8Array {
    return compilePreprocessed(parser, preprocessWithOrigins(file, options.preprocess), file, options);
}

/**
 * Compiles already-preprocessed source that still knows where its lines came from, restating every
 * diagnostic and warning in SOURCE coordinates. `compileText` positions them in the preprocessed text,
 * where directives have vanished and includes have spliced whole files in, so its lines are not the
 * author's; this layer owns the mapping because it is handed the origins the preprocessor recorded.
 */
export function compilePreprocessed(
    parser: Parser,
    source: PreprocessedSource,
    entry: string,
    options: CompileOptions = {},
): Uint8Array {
    try {
        return compileText(parser, source.text, toSourceOptions(options, source, entry));
    } catch (error) {
        throw toSourceError(error, source, entry);
    }
}

/**
 * The file and line an output line came from, with the file left out when it is the entry itself -
 * matching the `CompileDiagnostic` convention that an absent file means the script being compiled.
 */
function relocate(source: PreprocessedSource, entry: string, line: number): { file?: string; line: number } {
    const origin = source.origins[line - 1];
    if (!origin) return { line };
    return origin.file === path.resolve(entry) ? { line: origin.line } : { file: origin.file, line: origin.line };
}

/** Wraps a warning sink so warnings arrive in source coordinates, as `compilePreprocessed` promises. */
export function toSourceOptions(options: CompileOptions, source: PreprocessedSource, entry: string): CompileOptions {
    const sink = options.onWarning;
    if (!sink) return options;
    return { ...options, onWarning: (warning) => sink({ ...warning, ...relocate(source, entry, warning.line) }) };
}

/**
 * Restates an error `buildProgram`/`emitProgram` threw over this source in source coordinates.
 *
 * Only the compiler's own refusal shapes are touched - anything else is not positioned in the
 * preprocessed text and rewriting it would dress an internal crash up as a compile diagnostic. Exported
 * beside `toSourceOptions` for the caller that needs the program in between (the CLI's `-D` dump), which
 * `compilePreprocessed` cannot hand over.
 */
export function toSourceError(error: unknown, source: PreprocessedSource, entry: string): unknown {
    if (!(error instanceof CompileError || error instanceof LowerError || error instanceof EmitError)) return error;
    return new CompileError(
        problemsOf(error).map((problem) => ({
            column: problem.column,
            message: problem.message,
            ...relocate(source, entry, problem.line),
        })),
    );
}
