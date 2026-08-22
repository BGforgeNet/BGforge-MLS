/**
 * Moves a generated file's compiler diagnostics onto the source they came from.
 *
 * A transpiled language reaches the compiler in two steps - TSSL becomes SSL, TBAF becomes BAF, TD becomes
 * D - and only the second step reports compiler errors. Those arrive positioned in the generated file,
 * which the author never typed and often does not have open, at line numbers that do not correspond to
 * anything they can edit. Each transpiler records which source line every generated line came from, and
 * that record is what turns such an error back into somewhere to put the cursor.
 *
 * A generated line with no source behind it keeps its diagnostic where it is: those lines are scaffolding
 * the transpiler emitted on its own, and inventing a source line for them would point the author at code
 * that has nothing to do with the error.
 */

import type { Diagnostic } from "vscode-languageserver/node";
import type { SourcePosition } from "../../../transpilers/common/line-map";
import { getDiagnostics, setDiagnostics } from "../diagnostic-store";
import { pathToUri } from "../uri-utils";

/**
 * Re-files the compiler diagnostics currently held for `generatedUri`.
 *
 * @param generatedUri The transpiler's output file, as compiled.
 * @param sourceMap For each 0-based line of that file, where the author wrote it.
 */
export function relocateGeneratedDiagnostics(
    generatedUri: string,
    sourceMap: ReadonlyArray<SourcePosition | undefined>,
): void {
    const produced = getDiagnostics(generatedUri, "compiler");
    if (produced.length === 0) return;

    const unplaceable: Diagnostic[] = [];
    const relocated = new Map<string, Diagnostic[]>();

    for (const diagnostic of produced) {
        const origin = sourceMap[diagnostic.range.start.line];
        if (origin === undefined) {
            unplaceable.push(diagnostic);
            continue;
        }

        const uri = pathToUri(origin.file);
        let bucket = relocated.get(uri);
        if (!bucket) {
            bucket = [];
            relocated.set(uri, bucket);
        }
        bucket.push({
            ...diagnostic,
            // The map resolves lines, not columns: the generated columns index text the author never
            // wrote, so carrying them over would underline an unrelated span of their source.
            range: {
                start: { line: origin.line, character: 0 },
                end: { line: origin.line, character: 0 },
            },
        });
    }

    setDiagnostics(generatedUri, "compiler", unplaceable);
    for (const [uri, diagnostics] of relocated) {
        setDiagnostics(uri, "compiler", diagnostics);
    }
}
