/**
 * Give every statement of a bundle its own line, where the source map says two came from different
 * source lines.
 *
 * Line provenance through the transpiler is line-granular: each pass reports, per output line, the input
 * line it came from. That holds only while one output line means one place in one source. rolldown
 * breaks it - it prints
 *
 *     if (See(Player1)) { Attack(Player1); }   ->   if (See(Player1)) Attack(Player1);
 *
 * so the `if` and the action share a line, and the action's own line is unrecoverable from a per-line
 * map. esbuild kept the braces, which is why the assumption survived unexamined until the bundler
 * changed. Restoring one-statement-per-line fixes it at the assumption rather than threading columns
 * through every later pass, each of which rewrites identifiers and would have to keep them in step.
 *
 * Only lines the map says carry more than one source line are touched, and only at offsets that are
 * STATEMENT starts. That constraint is what makes the insertion safe: a newline before a statement
 * cannot change how the file parses, whereas one inside an expression can - `return x` becomes
 * `return; x`. An expression never starts a statement, so it is never a candidate.
 */

import { Node, type SourceFile } from "ts-morph";
import { getSharedProject } from "./shared-project";
import type { SourceOrigin } from "./source-map";

/** A position in the text a pass was given: 0-based line, 0-based column. */
export interface InputPosition {
    line: number;
    column: number;
}

/** Split text, and the position in the ORIGINAL text that each of its lines starts at. */
export interface SplitResult {
    code: string;
    /** One entry per line of `code`. */
    positions: readonly InputPosition[];
}

/**
 * Offsets at which a statement begins, as a set for O(1) lookup.
 *
 * Every statement counts, including one that is the unbraced body of an `if`/`else`/loop - which is
 * precisely the shape rolldown produces here. ts-morph reports those as statements in their own right,
 * so no special-casing is needed to find them.
 *
 * `Node.isStatement` rather than a kind-name suffix: a declaration is a statement too, and
 * `FunctionDeclaration`/`ClassDeclaration`/`EnumDeclaration` are not spelled with one. It also answers
 * true for `Block`, which the suffix test needed a second clause to reach.
 */
function statementStarts(sourceFile: SourceFile): Set<number> {
    const starts = new Set<number>();
    for (const node of sourceFile.getDescendants()) {
        // getStart() skips leading trivia, so the offset is the statement's first real token - which is
        // where a newline has to go for the statement to end up at the start of its own line.
        if (Node.isStatement(node)) {
            starts.add(node.getStart());
        }
    }
    return starts;
}

/**
 * Break lines that carry statements from more than one source line, at those statements' starts.
 *
 * `originsByLine` is the decoded source map for `code`, one entry per generated line. A line whose
 * segments all name the same source line is left exactly as it was, so on input the bundler already
 * lays out one statement per line this is the identity plus a position table.
 */
export function splitCollapsedStatements(
    code: string,
    originsByLine: ReadonlyArray<readonly SourceOrigin[]>,
): SplitResult {
    const lines = code.split("\n");
    const needsSplit = originsByLine.some((origins) => {
        const distinct = new Set(origins.map((o) => `${o.source}:${o.line}`));
        return distinct.size > 1;
    });
    if (!needsSplit) {
        return { code, positions: lines.map((_, line) => ({ line, column: 0 })) };
    }

    const sourceFile = getSharedProject().createSourceFile("split-statements.ts", code, { overwrite: true });
    const starts = statementStarts(sourceFile);

    const out: string[] = [];
    const positions: InputPosition[] = [];
    let offset = 0;

    lines.forEach((text, line) => {
        const origins = originsByLine[line] ?? [];
        // Columns where the source line changes: the only places a split buys anything.
        const boundaries = origins
            .filter((origin, i) => {
                const previous = origins[i - 1];
                return previous !== undefined && (previous.line !== origin.line || previous.source !== origin.source);
            })
            .map((origin) => origin.column)
            .filter((column) => column > 0 && starts.has(offset + column));

        let cut = 0;
        for (const column of boundaries) {
            out.push(text.slice(cut, column));
            positions.push({ line, column: cut });
            cut = column;
        }
        out.push(text.slice(cut));
        positions.push({ line, column: cut });
        // +1 for the newline that `split` consumed; the last line has none, and nothing reads past it.
        offset += text.length + 1;
    });

    const result = out.join("\n");
    // The split must not have changed how the file parses. Statement starts are chosen so it cannot,
    // but the check costs one parse and turns a wrong assumption into a caught one rather than a mod
    // file that compiles to something the author did not write.
    const reparsed = getSharedProject().createSourceFile("split-statements-check.ts", result, { overwrite: true });
    // Every emitted line needs a position, since a caller indexes this table by line and a short one
    // would silently report the last lines as unmapped.
    if (shape(reparsed) !== shape(sourceFile) || positions.length !== result.split("\n").length) {
        return { code, positions: lines.map((_, line) => ({ line, column: 0 })) };
    }

    return { code: result, positions };
}

/** The file's node kinds in order - equal before and after means the split changed no parse. */
function shape(sourceFile: SourceFile): string {
    return sourceFile
        .getDescendants()
        .map((node) => node.getKind())
        .join(",");
}
