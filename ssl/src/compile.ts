/**
 * The SSL compilation pipeline: source text to INT bytecode.
 *
 * Three stages, each usable on its own: the C preprocessor (`preprocess`), the shared tree-sitter
 * grammar, and lowering plus emission. The parser is supplied by the caller rather than constructed
 * here, because loading the grammar is asynchronous and callers - the language server, a CLI, a test -
 * already own a parser they should reuse.
 */

import type { Parser } from "web-tree-sitter";
import { emitInt, type EmitOptions } from "./int/emit";
import { lowerProgram, type LowerOptions } from "./lower";
import { preprocess, type PreprocessOptions } from "./preprocess";

export interface CompileOptions extends LowerOptions, EmitOptions {
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
        return emitInt(lowerProgram(tree, options), options);
    } finally {
        tree.delete();
    }
}

/** Compiles a source file, running the preprocessor first. */
export function compileFile(parser: Parser, file: string, options: CompileOptions = {}): Uint8Array {
    return compileText(parser, preprocess(file, options.preprocess), options);
}
