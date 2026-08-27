/**
 * Serializes a DLG canonical snapshot to its JSON text.
 *
 * The bytes direction lives in `index.ts` as `serializeDlg`, which consumers call directly: unlike the other
 * IE formats it needs the ORIGINAL bytes, because the text block's layout is not derivable from its contents
 * (see canonical-schemas.ts), so there is nothing for a wrapper here to add.
 */

import type { DlgCanonicalSnapshot } from "./canonical-schemas";

export function serializeDlgCanonicalSnapshot(snapshot: DlgCanonicalSnapshot): string {
    return `${JSON.stringify(snapshot, null, 4)}\n`;
}
