/**
 * Encodes a DLG canonical document back to bytes.
 *
 * Unlike the other IE formats this needs the ORIGINAL bytes, because the text block's layout is not
 * derivable from its contents (see canonical-schemas.ts). Every decoded section is written at its own
 * stored offset over a copy of the source, so the text block and any trailing slack survive verbatim.
 */

import { serializeDlg } from "./index";
import type { DlgCanonicalSnapshot } from "./canonical-schemas";
import type { ParseResult } from "../types";

export function serializeDlgCanonicalDocument(result: ParseResult): Uint8Array {
    return serializeDlg(result);
}

export function serializeDlgCanonicalSnapshot(snapshot: DlgCanonicalSnapshot): string {
    return `${JSON.stringify(snapshot, null, 4)}\n`;
}
