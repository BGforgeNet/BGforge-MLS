import {
    createProCanonicalSnapshot,
    proCanonicalSnapshotSchemaPermissive,
    serializeProCanonicalSnapshot,
    type ProCanonicalSnapshot,
} from "./canonical";
import { proParser } from "./index";
import { parseWithSchemaValidation } from "../schema-validation";
import type { ParseOptions, ParseResult } from "../types";

interface LoadedCanonicalProSnapshot {
    readonly snapshot: ProCanonicalSnapshot;
    readonly bytes: Uint8Array;
    readonly parseResult: ParseResult;
}

export function createCanonicalProJsonSnapshot(parseResult: ParseResult): string {
    return `${JSON.stringify(createProCanonicalSnapshot(parseResult), null, 2)}\n`;
}

export function loadCanonicalProJsonSnapshot(
    jsonText: string,
    parseOptions?: ParseOptions,
): LoadedCanonicalProSnapshot {
    // Snapshot load is permissive: a snapshot dumped from a graceful-loaded
    // file may carry out-of-enum / out-of-domain values, and we want it to
    // round-trip back to the editor for display. The strict gate fires when
    // the user explicitly serializes the canonical doc back to bytes for save
    // (see canonical-writer's serializeProCanonicalDocument).
    const snapshot = parseWithSchemaValidation(
        proCanonicalSnapshotSchemaPermissive,
        JSON.parse(jsonText),
        "Invalid canonical PRO snapshot",
    );
    const bytes = serializeProCanonicalSnapshot(snapshot);
    const reparsed = proParser.parse(bytes, parseOptions);
    if (reparsed.errors && reparsed.errors.length > 0) {
        throw new Error(`Canonical PRO snapshot did not round-trip: ${reparsed.errors[0]}`);
    }

    const reparsedSnapshot = createProCanonicalSnapshot(reparsed);
    if (JSON.stringify(snapshot) !== JSON.stringify(reparsedSnapshot)) {
        throw new Error("Canonical PRO snapshot did not round-trip semantically");
    }

    return { snapshot, bytes, parseResult: reparsed };
}
