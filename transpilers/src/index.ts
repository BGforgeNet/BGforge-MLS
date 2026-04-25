/**
 * @bgforge/transpile — public API.
 *
 * Wraps the four internal transpiler workspace packages (common, tssl, tbaf,
 * td). The internal packages stay private; their code is bundled into this
 * library at publish time.
 */

import { EXT_TSSL, EXT_TBAF, EXT_TD } from "../common/extensions";
import { transpile as tsslImpl } from "../tssl/src/index";
import { transpile as tbafImpl } from "../tbaf/src/index";
import { transpile as tdImpl } from "../td/src/index";

export const tssl = tsslImpl;
export const tbaf = tbafImpl;
export const td = tdImpl;

export type TranspileResult =
    | { kind: "tssl"; output: string }
    | { kind: "tbaf"; output: string }
    | { kind: "td"; output: string; warnings: ReadonlyArray<{ line: number; message: string }> };

export class UnknownTranspileExtensionError extends Error {
    constructor(filePath: string) {
        super(`Unknown transpile extension for "${filePath}". Accepted: ${EXT_TSSL}, ${EXT_TBAF}, ${EXT_TD}`);
        this.name = "UnknownTranspileExtensionError";
    }
}

/**
 * Dispatch by file extension. Throws UnknownTranspileExtensionError for any
 * extension other than .tssl/.tbaf/.td.
 */
export async function transpile(filePath: string, source: string): Promise<TranspileResult> {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(EXT_TSSL)) {
        const output = await tssl(filePath, source);
        return { kind: "tssl", output };
    }
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
