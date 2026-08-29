/**
 * Where a transpiler source's generated output goes, and the refusal for an extension that has none.
 *
 * Lives apart from the `@bgforge/transpile` barrel, which re-exports it, because the barrel imports the
 * TD and TBAF transpilers and so drags ts-morph in with it. A consumer that only needs to NAME the
 * output path - the server, which hands the transpile itself to a worker - would otherwise pull the
 * whole transpiler graph into its bundle to call two lines of string manipulation.
 */

import { EXT_TBAF, EXT_TD, EXT_WEIDU_BAF, EXT_WEIDU_D } from "./extensions";

export class UnknownTranspileExtensionError extends Error {
    constructor(filePath: string) {
        super(`Unknown transpile extension for "${filePath}". Accepted: ${EXT_TBAF}, ${EXT_TD}`);
        this.name = "UnknownTranspileExtensionError";
    }
}

/**
 * Compute the compiled-output path for a transpiler source file by swapping the
 * source extension for its target: .tbaf -> .baf, .td -> .d.
 * Throws UnknownTranspileExtensionError for any other extension. The caller owns
 * writing the file - this only names where it goes, single-sourcing the
 * source/target extension mapping that compile consumers would otherwise hardcode.
 */
export function outputPathFor(filePath: string): string {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(EXT_TBAF)) return filePath.slice(0, -EXT_TBAF.length) + EXT_WEIDU_BAF;
    if (lower.endsWith(EXT_TD)) return filePath.slice(0, -EXT_TD.length) + EXT_WEIDU_D;
    throw new UnknownTranspileExtensionError(filePath);
}
