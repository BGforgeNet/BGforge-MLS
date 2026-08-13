/**
 * The SSL compilation pipeline: source text to INT bytecode.
 *
 * Three stages, each usable on its own: the C preprocessor (`preprocess`), the shared tree-sitter
 * grammar, and lowering plus emission. The parser is supplied by the caller rather than constructed
 * here, because loading the grammar is asynchronous and callers - the language server, a CLI, a test -
 * already own a parser they should reuse.
 */

import type { Parser } from "web-tree-sitter";
import { findParseError } from "../../shared/parse-errors";
import { emitInt, type EmitOptions } from "./int/emit";
import { lowerProgram, type LowerOptions } from "./lower";
import { optimize, type OptimizeOptions } from "./optimize";
import { preprocess, type PreprocessOptions } from "./preprocess";

export interface CompileOptions extends LowerOptions, EmitOptions, OptimizeOptions {
    preprocess?: PreprocessOptions;
}

export class CompileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CompileError";
    }
}

/** Compiles already-preprocessed source text. */
export function compileText(parser: Parser, text: string, options: CompileOptions = {}): Uint8Array {
    const tree = parser.parse(text);
    if (tree === null) throw new CompileError("parser returned no tree");
    try {
        // A tree-sitter parse always succeeds, standing in ERROR and MISSING nodes for whatever did not
        // fit the grammar. Lowering walks past those without complaint and emits a program built from
        // the fragments it did understand, so the refusal has to happen here: a script the parser could
        // not read must not silently produce a compiled file that does something else.
        const error = findParseError(tree.rootNode);
        if (error) {
            const { row, column } = error.startPosition;
            const what = error.isMissing ? `missing ${error.type}` : "syntax error";
            throw new CompileError(`${row + 1}:${column + 1}: ${what}`);
        }
        return emitInt(optimize(lowerProgram(tree, options), options), {
            ...options,
            // The optimiser removes the code that would reach a fall-through epilogue, so the emitter
            // stops writing one at the level where that removal happens.
            dropUnreachableEpilogue: (options.level ?? 0) >= 2,
        });
    } finally {
        tree.delete();
    }
}

/** Compiles a source file, running the preprocessor first. */
export function compileFile(parser: Parser, file: string, options: CompileOptions = {}): Uint8Array {
    return compileText(parser, preprocess(file, options.preprocess), options);
}
