import { formatAdapterRegistry, type BinaryFormatAdapter } from "./format-adapter";
import type { ParseOptions, ParseResult } from "./types";

function requireFormatAdapter(format: string): BinaryFormatAdapter {
    const adapter = formatAdapterRegistry.get(format);
    if (!adapter) {
        throw new Error(`No format adapter is registered for format "${format}"`);
    }
    return adapter;
}

export function createBinaryJsonSnapshot(parseResult: ParseResult): string {
    return requireFormatAdapter(parseResult.format).createJsonSnapshot(parseResult);
}

export function parseBinaryJsonSnapshot(jsonText: string): ParseResult {
    return loadBinaryJsonSnapshot(jsonText).parseResult;
}

export function loadBinaryJsonSnapshot(
    jsonText: string,
    parseOptions?: ParseOptions,
): { parseResult: ParseResult; bytes?: Uint8Array } {
    try {
        const parsed = JSON.parse(jsonText) as unknown;
        const format =
            typeof parsed === "object" && parsed !== null ? (parsed as { format?: unknown }).format : undefined;
        if (typeof format !== "string") {
            throw new TypeError('"format" must be a string');
        }
        return requireFormatAdapter(format).loadJsonSnapshot(jsonText, parseOptions);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON snapshot: ${message}`, { cause: error });
    }
}
