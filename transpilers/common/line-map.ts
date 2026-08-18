/**
 * Line provenance across the passes between a source file and the text ts-morph finally parses.
 *
 * Each pass reports, for every line it emits, the 0-based line of ITS input that line came from. The
 * relation is not one-to-one in either direction: a pass drops lines (a bundler prelude, an import
 * declaration, an unreferenced enum object) and rewrites one statement into several, so a value can
 * repeat. Composing the per-pass reports gives one lookup from the final text back to where a position
 * started, which is what lets a failure found after bundling be reported against what the author wrote.
 *
 * Deliberately free of imports so any pass can use it without risking a cycle.
 */

/** A place in a file the author wrote: an absolute path, and a 0-based line in it. */
export interface SourcePosition {
    file: string;
    line: number;
}

/** Lines in a string, counting a trailing newline as ending the last line rather than starting a new one. */
export function lineCount(text: string): number {
    if (text === "") return 0;
    const newlines = (text.match(/\n/g) ?? []).length;
    return text.endsWith("\n") ? newlines : newlines + 1;
}

/** One statement rewritten in place: where it started, how many lines it held, how many it left behind. */
export interface LineEdit {
    startLine: number;
    inputSpan: number;
    outputSpan: number;
}

/**
 * The line each output line came from, for a pass that rewrites whole statements and leaves the rest
 * alone. A line no edit covers keeps its index; a rewritten one contributes its replacement's lines, all
 * naming where it began - which is the useful answer, since that is the statement the author wrote.
 */
export function survivorsFromEdits(edits: LineEdit[], inputLines: number): number[] {
    const survivors: number[] = [];
    let next = 0;
    for (const edit of [...edits].sort((a, b) => a.startLine - b.startLine)) {
        for (let line = next; line < edit.startLine; line++) survivors.push(line);
        for (let i = 0; i < edit.outputSpan; i++) survivors.push(edit.startLine);
        next = edit.startLine + edit.inputSpan;
    }
    for (let line = next; line < inputLines; line++) survivors.push(line);
    return survivors;
}

/**
 * Chains two passes: `first` maps pass-one output lines to original lines, `second` maps pass-two output
 * lines to pass-one output lines. A second-pass line pointing past what the first reported keeps its own
 * index, so a pass that grew the text cannot produce an undefined origin.
 */
export function composeLineMaps(first: readonly number[], second: readonly number[]): number[] {
    return second.map((line) => first[line] ?? line);
}
