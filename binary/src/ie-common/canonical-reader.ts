/**
 * Shared canonical-reader factory for the IE binary formats (ITM, SPL, EFF).
 *
 * Each format's `<format>/canonical-reader.ts` calls `createIeCanonicalReader`
 * to get the three operations every IE format needs:
 *   - `getDocument(result)`     — pull the canonical doc off `result.document`
 *                                 with permissive schema validation, undefined
 *                                 if absent.
 *   - `rebuildDocument(result)` — same plus a non-null assertion; the parser
 *                                 always sets `result.document`, so a missing
 *                                 doc here is a programming error.
 *   - `createSnapshot(result)`  — wrap the doc in the IE snapshot envelope
 *                                 (`schemaVersion: 1`, `format`, `formatName`,
 *                                 optional `opaqueRanges` / `warnings`).
 *
 * The body of each operation was byte-identical across the three formats
 * (`s/itm/spl/eff/`); only the schema types and the format-id discriminant
 * varied. Hand-rolling the same shape per format guaranteed they'd drift —
 * one format could grow a snapshot field the others didn't get.
 */

import { z } from "zod";
import { parseWithSchemaValidation } from "../schema-validation";
import type { ParseResult } from "../types";

export type IeFormatId = "itm" | "spl" | "eff";

interface IeSnapshotEnvelope<Doc> {
    readonly schemaVersion: 1;
    readonly format: IeFormatId;
    readonly formatName?: string;
    readonly document: Doc;
}

export interface IeCanonicalReaderConfig<Doc, Snap extends IeSnapshotEnvelope<Doc>> {
    readonly formatId: IeFormatId;
    /** Display label used in error messages (`"ITM"`, `"SPL"`, `"EFF"`). */
    readonly formatLabel: string;
    readonly documentSchemaPermissive: z.ZodType<Doc>;
    readonly snapshotSchemaPermissive: z.ZodType<Snap>;
}

export interface IeCanonicalReader<Doc, Snap extends IeSnapshotEnvelope<Doc>> {
    readonly getDocument: (result: ParseResult) => Doc | undefined;
    readonly rebuildDocument: (result: ParseResult) => Doc;
    readonly createSnapshot: (result: ParseResult) => Snap;
}

export function createIeCanonicalReader<Doc, Snap extends IeSnapshotEnvelope<Doc>>(
    config: IeCanonicalReaderConfig<Doc, Snap>,
): IeCanonicalReader<Doc, Snap> {
    const { formatId, formatLabel, documentSchemaPermissive, snapshotSchemaPermissive } = config;

    const getDocument = (result: ParseResult): Doc | undefined => {
        if (!result.document) return undefined;
        return parseWithSchemaValidation(
            documentSchemaPermissive,
            result.document,
            `Invalid ${formatLabel} canonical document`,
        );
    };

    const rebuildDocument = (result: ParseResult): Doc => {
        const doc = getDocument(result);
        if (!doc) {
            throw new Error(
                `${formatLabel} canonical document missing from ParseResult; display-tree-only rebuild is not implemented`,
            );
        }
        return doc;
    };

    const createSnapshot = (result: ParseResult): Snap => {
        const document = rebuildDocument(result);
        // Build the wire-shape envelope every IE snapshot has, then promote
        // through the snapshot zod for variants that carry `opaqueRanges`
        // (validates the shape) or attach `warnings` directly. The cast is
        // safe by construction: Snap extends IeSnapshotEnvelope<Doc>, and
        // we only ever produce the union of {base, base+opaqueRanges,
        // base+warnings} which the per-format snapshot schema enumerates.
        const envelope: IeSnapshotEnvelope<Doc> = {
            schemaVersion: 1,
            format: formatId,
            formatName: result.formatName,
            document,
        };
        if (result.opaqueRanges && result.opaqueRanges.length > 0) {
            return parseWithSchemaValidation(
                snapshotSchemaPermissive,
                { ...envelope, opaqueRanges: result.opaqueRanges },
                `Invalid ${formatLabel} canonical snapshot`,
            );
        }
        if (result.warnings) {
            return { ...envelope, warnings: result.warnings } as unknown as Snap;
        }
        return envelope as unknown as Snap;
    };

    return { getDocument, rebuildDocument, createSnapshot };
}
