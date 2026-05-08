/**
 * Shared JSON-snapshot factory for the IE binary formats (ITM, SPL, EFF).
 *
 * Each format's `<format>/json-snapshot.ts` calls `createIeJsonSnapshot` to
 * get a serialise/load pair that follows the same round-trip discipline:
 *   - `createJson(result)`     — JSON.stringify the canonical snapshot.
 *   - `loadJson(text, opts)`   — parse the JSON, validate against the
 *                                permissive snapshot schema, serialise to
 *                                bytes, re-parse, and assert the re-parsed
 *                                snapshot stringifies identically. The
 *                                parser is provided as a thunk so per-format
 *                                callers can avoid the canonical layer →
 *                                parser → canonical layer import cycle.
 *
 * Failure-mode design: load throws on either parser-level errors or a
 * semantic round-trip mismatch. Both indicate a hand-edited snapshot whose
 * bytes don't reflect the doc shape (or a parser bug); the caller doesn't
 * silently get an out-of-sync result.
 */

import { z } from "zod";
import { parseWithSchemaValidation } from "../schema-validation";
import type { BinaryParser, ParseOptions, ParseResult } from "../types";

export interface IeJsonSnapshotConfig<Snap> {
    readonly formatLabel: string;
    readonly snapshotSchemaPermissive: z.ZodType<Snap>;
    readonly createSnapshot: (result: ParseResult) => Snap;
    readonly serializeSnapshot: (snapshot: Snap) => Uint8Array;
    /**
     * Lazy parser accessor — the parser usually transitively imports the
     * canonical layer, so resolving it eagerly here would create a cycle.
     * The thunk is invoked on first load.
     */
    readonly getParser: () => BinaryParser;
}

export interface IeLoadedJsonSnapshot<Snap> {
    readonly snapshot: Snap;
    readonly bytes: Uint8Array;
    readonly parseResult: ParseResult;
}

export interface IeJsonSnapshot<Snap> {
    readonly createJson: (result: ParseResult) => string;
    readonly loadJson: (jsonText: string, parseOptions?: ParseOptions) => IeLoadedJsonSnapshot<Snap>;
}

export function createIeJsonSnapshot<Snap>(config: IeJsonSnapshotConfig<Snap>): IeJsonSnapshot<Snap> {
    const { formatLabel, snapshotSchemaPermissive, createSnapshot, serializeSnapshot, getParser } = config;

    const createJson = (result: ParseResult): string => {
        return `${JSON.stringify(createSnapshot(result), null, 2)}\n`;
    };

    const loadJson = (jsonText: string, parseOptions?: ParseOptions): IeLoadedJsonSnapshot<Snap> => {
        const snapshot = parseWithSchemaValidation(
            snapshotSchemaPermissive,
            JSON.parse(jsonText),
            `Invalid canonical ${formatLabel} snapshot`,
        );
        const bytes = serializeSnapshot(snapshot);
        const reparsed = getParser().parse(bytes, parseOptions);
        if (reparsed.errors && reparsed.errors.length > 0) {
            throw new Error(`Canonical ${formatLabel} snapshot did not round-trip: ${reparsed.errors[0]}`);
        }
        const reparsedSnapshot = createSnapshot(reparsed);
        if (JSON.stringify(snapshot) !== JSON.stringify(reparsedSnapshot)) {
            throw new Error(`Canonical ${formatLabel} snapshot did not round-trip semantically`);
        }
        return { snapshot, bytes, parseResult: reparsed };
    };

    return { createJson, loadJson };
}
