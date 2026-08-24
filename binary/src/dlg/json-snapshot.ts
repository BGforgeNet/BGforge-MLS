/**
 * DLG JSON snapshot.
 *
 * Hand-written rather than built on `ie-common/json-snapshot.ts`: that factory reconstructs bytes from the
 * canonical document alone, which DLG cannot do - the text block's layout is not derivable (see
 * canonical-schemas.ts). The block therefore rides along as an opaque range, which is what keeps the
 * snapshot a complete description of the file rather than a lossy view of it.
 */

import { decodeOpaqueRange } from "../opaque-range";
import { parseWithSchemaValidation } from "../schema-validation";
import {
    dlgCanonicalSnapshotSchemaPermissive,
    type DlgCanonicalDocument,
    type DlgCanonicalSnapshot,
} from "./canonical-schemas";
import { serializeDlgCanonicalSnapshot } from "./canonical-writer";
import { sectionsEnd, serializeDlg } from "./index";
import type { ParseOpaqueRange, ParseResult } from "../types";

export function createCanonicalDlgJsonSnapshot(parseResult: ParseResult): string {
    const document = parseResult.document as DlgCanonicalDocument | undefined;
    if (!document) throw new Error("Cannot snapshot DLG: parse result carries no canonical document");

    const snapshot: DlgCanonicalSnapshot = {
        schemaVersion: 1,
        format: "dlg",
        formatName: parseResult.formatName,
        document,
        ...(parseResult.opaqueRanges ? { opaqueRanges: parseResult.opaqueRanges } : {}),
        ...(parseResult.warnings ? { warnings: parseResult.warnings } : {}),
        ...(parseResult.errors ? { errors: parseResult.errors } : {}),
    };
    return serializeDlgCanonicalSnapshot(snapshot);
}

export function loadCanonicalDlgJsonSnapshot(jsonText: string): { parseResult: ParseResult; bytes?: Uint8Array } {
    const snapshot = parseWithSchemaValidation(
        dlgCanonicalSnapshotSchemaPermissive,
        JSON.parse(jsonText),
        "Invalid DLG canonical snapshot",
    );
    // The permissive schema infers its document loosely, but `parseWithSchemaValidation` above has already
    // checked it against that schema - this narrows to the shape it validated.
    const document = snapshot.document as DlgCanonicalDocument;
    const bytes = rebuildBytes(document, snapshot.opaqueRanges);

    return {
        parseResult: {
            format: "dlg",
            formatName: snapshot.formatName,
            root: { name: "DLG File", fields: [], expanded: true },
            document,
            opaqueRanges: snapshot.opaqueRanges,
            sourceData: bytes,
            warnings: snapshot.warnings,
            errors: snapshot.errors,
        },
        bytes,
    };
}

/**
 * Lays the text block back down at its recorded offset, then lets the serializer write the decoded
 * sections over it. Without the block the snapshot could not describe a whole file, so its absence is an
 * error rather than a silently shorter output.
 */
function rebuildBytes(document: DlgCanonicalDocument, ranges: ParseOpaqueRange[] | undefined): Uint8Array {
    const text = ranges?.find((r) => r.label === "text");
    // A dialog with no triggers and no actions has no text block, so its absence is legitimate; the file is
    // then exactly its tables.
    const out = new Uint8Array(text ? text.offset + text.size : sectionsEnd(document));
    if (text) out.set(decodeOpaqueRange(text), text.offset);
    return serializeDlg({
        format: "dlg",
        formatName: "Infinity Engine DLG v1",
        root: { name: "DLG File", fields: [], expanded: true },
        document,
        sourceData: out,
    });
}
