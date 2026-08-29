/**
 * @bgforge/transpile - public API.
 *
 * Wraps the internal transpiler workspace packages (common, tbaf, td). They stay private; their code
 * is bundled into this library at publish time.
 *
 * TSSL is NOT here. It moved to `compilers/tssl` and ships as `@bgforge/tssl` with its own `tssl` bin,
 * because it is a compiler now rather than a transpiler: its default output is INT bytecode and the SSL
 * text is one option of it.
 */

import { EXT_TBAF, EXT_TD } from "../common/extensions";
import { UnknownTranspileExtensionError } from "../common/output-path";
import { transpile as tbafImpl } from "../tbaf/src/index";
import { transpile as tdImpl, type TDWarning } from "../td/src/index";

// Public because a failure's source location is part of what a caller gets back: a consumer placing
// diagnostics needs to narrow to this to read the location, and every transpiler throws it.
export { TranspileError } from "../common/transpile-error";

export const tbaf = tbafImpl;
export const td = tdImpl;

/**
 * Transpile, and also report where in the author's files each generated line came from.
 *
 * The compiler that reads the generated file positions its errors in it, so a consumer showing those
 * errors in an editor needs this to put them where the author can act on them. TD has no sibling here
 * because its `td` already returns a result object - it carries warnings - and the map rides along on it.
 */
export { transpileWithSourceMap as tbafWithSourceMap } from "../tbaf/src/index";

/** Where a generated line came from: an absolute path, and a 0-based line in it. */
export type { SourcePosition } from "../common/line-map";

// The warnings array is narrowed to Pick<TDWarning, "line" | "message"> rather than
// exposing TDWarning directly. This keeps the public API surface minimal while
// remaining structurally tied to TDWarning: a rename of the line/message fields
// upstream will produce a compile error here rather than a silent runtime mismatch.
export type TranspileResult =
    | { kind: "tbaf"; output: string }
    | { kind: "td"; output: string; warnings: ReadonlyArray<Pick<TDWarning, "line" | "message">> };

// Defined in common/output-path so a consumer needing only the output path can reach it without this
// barrel, which imports both transpilers and so carries ts-morph. Re-exported: the public API is unchanged.
export { outputPathFor, UnknownTranspileExtensionError } from "../common/output-path";

/**
 * Dispatch by file extension. Throws UnknownTranspileExtensionError for any
 * extension other than .tbaf/.td.
 */
export async function transpile(filePath: string, source: string): Promise<TranspileResult> {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(EXT_TBAF)) {
        const output = await tbaf(filePath, source);
        return { kind: "tbaf", output };
    }
    if (lower.endsWith(EXT_TD)) {
        const result = await td(filePath, source);
        return { kind: "td", output: result.output, warnings: result.warnings };
    }
    throw new UnknownTranspileExtensionError(filePath);
}
