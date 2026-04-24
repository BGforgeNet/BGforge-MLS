/**
 * TD Transpiler - Main Entry Point
 *
 * Transpiles TypeScript Dialog (.td) to WeiDU D format.
 * Uses the shared transpiler pipeline for orchestration.
 *
 * Orphan detection runs on the ORIGINAL source (before bundling) because
 * esbuild tree-shakes unreferenced function declarations. A function like
 * `function state29() { ... }` that isn't passed to begin/append is dead code
 * from esbuild's perspective and gets removed from the bundled output — making
 * it invisible to the parser. By scanning the original source, we detect these
 * orphans regardless of tree-shaking.
 */

import { Node, Project, SyntaxKind } from "ts-morph";
import { EXT_TD } from "../../common/extensions";
import { createTranspiler, type TranspilerEvent } from "../../common/transpiler-pipeline";
import { bundle } from "../../common/bundle";
import { emitD } from "./emit";
import { parse } from "./parse";
import { collectExplicitLabels } from "./state-resolution";
import { ORPHAN_WARNING_TEMPLATE, type TDScript, type TDWarning } from "./types";

interface TDTranspileResult {
    output: string;
    warnings: TDWarning[];
}

interface TDCompileResult {
    dPath: string;
    warnings: TDWarning[];
    events: readonly TranspilerEvent[];
}

const td = createTranspiler<TDTranspileResult>({
    sourceExtension: EXT_TD,
    targetExtension: ".d",
    name: "TD",

    async transpileCore(filePath, text, traTag) {
        // 1. Bundle imports (skips bundling internally for files without imports)
        const bundled = await bundle(filePath, text);

        // 2. Parse bundled code.
        // Uses a per-compile Project rather than the module-scoped shared one
        // in transpilers/common/shared-project.ts. The bundled source and the
        // original source (for orphan detection below) both live through the
        // whole transpile; a concurrent transpile would overwrite their
        // virtual files mid-walk. Fresh-Project construction at per-compile
        // granularity is a small fraction of total compile time.
        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile("bundled.ts", bundled);

        // 3. Parse AST to IR, using original file path for the header comment
        const ir = { ...parse(sourceFile), sourceFile: filePath, traTag };

        // 4. Detect orphans from original source (pre-bundling).
        // The parser's own orphan detection runs on bundled code, which may be
        // missing tree-shaken functions. This pass catches those.
        // Skip when bundling didn't change the source (no imports = no tree-shaking).
        const orphanWarnings = bundled === text ? [] : detectOrphansFromOriginal(text, ir);
        const warnings = mergeWarnings(ir.warnings ?? [], orphanWarnings);

        // 5. Emit D text
        const output = emitD(ir);

        return { output, warnings };
    },

    getOutput: (result) => result.output,
});

/**
 * Compile a TD file to D, writing the output to disk.
 * Used by the LSP compile handler.
 */
export async function compile(uri: string, text: string): Promise<TDCompileResult> {
    const { outPath, result, events } = await td.compile(uri, text);
    return { dPath: outPath, warnings: result.warnings, events };
}

/**
 * Transpile TD to D, returning the output string without writing to disk.
 * Used by the CLI where the caller controls file I/O.
 */
export async function transpile(filePath: string, text: string): Promise<TDTranspileResult> {
    return td.transpile(filePath, text);
}

/** Function metadata extracted from the original (pre-bundling) source. */
interface OriginalFunc {
    name: string;
    paramCount: number;
    line: number;
    columnStart: number;
    columnEnd: number;
}

/**
 * Detect orphan state functions by scanning the ORIGINAL source text.
 *
 * esbuild tree-shakes unreferenced functions, so the parser (which operates
 * on bundled code) can't see them. This function parses the original source
 * to find functions that:
 * - Have no parameters (look like state functions, not helpers)
 * - Are not collected by any begin/append construct in the IR
 * - Are not used as direct callees (helper pattern)
 */
export function detectOrphansFromOriginal(originalText: string, ir: TDScript): TDWarning[] {
    // Per-compile Project, same rationale as transpileCore above:
    // the source file outlives a single synchronous call (three descendant
    // walks below), so a shared Project would be racy under concurrent
    // compiles. Construction cost is small relative to per-compile work.
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile("original.td", originalText);

    // Collect all function declarations from original source
    const funcs = new Map<string, OriginalFunc>();
    for (const func of sf.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
        const name = func.getName();
        if (!name) continue;

        const nameNode = func.getNameNode();
        if (!nameNode) continue;
        funcs.set(name, {
            name,
            paramCount: func.getParameters().length,
            line: nameNode.getStartLineNumber(),
            columnStart: sf.getLineAndColumnAtPos(nameNode.getStart()).column - 1,
            columnEnd: sf.getLineAndColumnAtPos(nameNode.getEnd()).column - 1,
        });
    }

    // Detect functions used as direct callees (helpers).
    // e.g. learnSpell(3, 7, "wm_blade", 2) -> learnSpell is a callee -> helper
    const calledAsFunction = new Set<string>();
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        if (Node.isIdentifier(callee) && funcs.has(callee.getText())) {
            calledAsFunction.add(callee.getText());
        }
    }

    // Collect all state labels from IR constructs (includes transitively collected)
    const collectedLabels = collectExplicitLabels(ir.constructs);

    // Generate warnings for orphan functions
    const warnings: TDWarning[] = [];
    for (const [name, info] of funcs) {
        if (collectedLabels.has(name)) continue;
        if (calledAsFunction.has(name)) continue;
        if (info.paramCount > 0) continue;

        warnings.push({
            message: ORPHAN_WARNING_TEMPLATE(name),
            line: info.line,
            columnStart: info.columnStart,
            columnEnd: info.columnEnd,
        });
    }

    return warnings;
}

/**
 * Merge parser warnings with original-source orphan warnings, deduplicating
 * by function name (a function that survived bundling would be caught by both).
 */
export function mergeWarnings(parserWarnings: TDWarning[], orphanWarnings: TDWarning[]): TDWarning[] {
    // Prefer original-source warnings (they have correct line numbers from the
    // original file, not the bundled intermediate).
    const seenMessages = new Set<string>();
    const result: TDWarning[] = [];

    for (const w of orphanWarnings) {
        seenMessages.add(w.message);
        result.push(w);
    }

    for (const w of parserWarnings) {
        if (!seenMessages.has(w.message)) {
            result.push(w);
        }
    }

    return result;
}
