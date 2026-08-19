/**
 * The compiler's aggregate refusal, in its own module so both the pipeline (`compile.ts`) and the
 * error-flattening reader (`problems.ts`) can name it without importing each other.
 */

/** One located complaint, so a caller can place it without parsing the message back apart. */
export interface CompileDiagnostic {
    /** The file the problem is in, when it is not the script being compiled; absent means that script. */
    file?: string;
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
