/**
 * The SSL compilation pipeline: source text to INT bytecode.
 *
 * Three stages, each usable on its own: the C preprocessor (`preprocess`), the shared tree-sitter
 * grammar, and lowering plus emission. The parser is supplied by the caller rather than constructed
 * here, because loading the grammar is asynchronous and callers - the language server, a CLI, a test -
 * already own a parser they should reuse.
 */

import type { Parser } from "web-tree-sitter";
import { collectParseErrors } from "../../../shared/parse-errors";
import { emitInt, type EmitOptions } from "./int/emit";
import type { Program } from "./int/ir";
import { lowerProgram, type LowerOptions } from "./lower";
import { optimize, type OptimizeOptions } from "./optimize";
import { preprocess, type PreprocessOptions } from "./preprocess";

export interface CompileOptions extends LowerOptions, EmitOptions, OptimizeOptions {
    preprocess?: PreprocessOptions;
}

/** One located complaint, so a caller can place it without parsing the message back apart. */
export interface CompileDiagnostic {
    line: number;
    column: number;
    message: string;
}

export class CompileError extends Error {
    /**
     * Every problem this compile found, not just the one the message names.
     *
     * `message` stays the FIRST of them, formatted exactly as it always was, so a caller that only knows
     * how to show one error keeps working unchanged - including the language server's `line:column:`
     * parsing. A caller that can show more reads this instead.
     */
    readonly diagnostics: readonly CompileDiagnostic[];

    constructor(diagnostics: CompileDiagnostic[]) {
        const first = diagnostics[0];
        super(first ? `${first.line}:${first.column}: ${first.message}` : "compilation failed");
        this.name = "CompileError";
        this.diagnostics = diagnostics;
    }
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
        // The optimiser removes the code that would reach a fall-through epilogue, so the emitter stops
        // writing one at the level where that removal happens.
        dropUnreachableEpilogue: (options.level ?? 0) >= 2,
    });
}

/** Compiles already-preprocessed source text. */
export function compileText(parser: Parser, text: string, options: CompileOptions = {}): Uint8Array {
    return emitProgram(buildProgram(parser, text, options), options);
}

/** Compiles a source file, running the preprocessor first. */
export function compileFile(parser: Parser, file: string, options: CompileOptions = {}): Uint8Array {
    return compileText(parser, preprocess(file, options.preprocess), options);
}
