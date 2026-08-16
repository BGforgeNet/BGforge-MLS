/**
 * What a compiler error says, flattened into a list an editor can place.
 *
 * Each refusal shape carries its problems differently - the preprocessor names a file per problem
 * because an included header reports against the header, lowering collects every complaint it found,
 * and anything else is a single error whose position is only in its message text. Consumers want the
 * same thing from all of them, so the reading happens once here rather than once per consumer: the
 * language server places them in the Problems panel, and the compiled-script editor refuses a save.
 *
 * A consumer that mapped only the shapes it had seen would silently degrade on the others - which is
 * exactly what happened when the editor knew `CompileError` and lowering threw its own error instead.
 */

import { CompileError } from "./compile";
import { LowerError } from "./lower";
import { PreprocessError } from "./preprocess";

export interface CompilerProblem {
    /** The file the problem is in, when the error names one; absent means the script being compiled. */
    file?: string;
    /** 1-based, as every layer of this compiler reports positions. */
    line: number;
    /** 1-based, and 0 where the error could only be located to a line. */
    column: number;
    message: string;
}

/** Every problem an error carries, most important first. */
export function problemsOf(error: unknown): CompilerProblem[] {
    if (error instanceof PreprocessError) {
        // The full message, `file:line:` prefix and all: a directive error is often reported against a
        // header the reader did not open, and the prefix is what says which file that was.
        return error.all.map((one) => ({ file: one.file, line: one.line, column: 0, message: one.message }));
    }
    if (error instanceof CompileError && error.diagnostics.length > 0) {
        return error.diagnostics.map((one) => ({ line: one.line, column: one.column, message: one.message }));
    }
    if (error instanceof LowerError) {
        return error.all.map((one) => ({ line: one.line, column: one.column, message: one.detail }));
    }
    // Anything else located itself only in its text, if at all.
    const message = error instanceof Error ? error.message : String(error);
    const located = /^(\d+):(\d+): (.*)$/s.exec(message);
    if (!located) return [{ line: 1, column: 0, message }];
    return [{ line: Number(located[1]), column: Number(located[2]), message: located[3]! }];
}
