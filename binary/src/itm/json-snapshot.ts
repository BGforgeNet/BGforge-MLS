import {
    createItmCanonicalSnapshot,
    itmCanonicalSnapshotSchemaPermissive,
    serializeItmCanonicalSnapshot,
    type ItmCanonicalSnapshot,
} from "./canonical";
import { itmParser } from "./index";
import { parseWithSchemaValidation } from "../schema-validation";
import type { ParseOptions, ParseResult } from "../types";

interface LoadedCanonicalItmSnapshot {
    readonly snapshot: ItmCanonicalSnapshot;
    readonly bytes: Uint8Array;
    readonly parseResult: ParseResult;
}

export function createCanonicalItmJsonSnapshot(parseResult: ParseResult): string {
    return `${JSON.stringify(createItmCanonicalSnapshot(parseResult), null, 2)}\n`;
}

export function loadCanonicalItmJsonSnapshot(
    jsonText: string,
    parseOptions?: ParseOptions,
): LoadedCanonicalItmSnapshot {
    const snapshot = parseWithSchemaValidation(
        itmCanonicalSnapshotSchemaPermissive,
        JSON.parse(jsonText),
        "Invalid canonical ITM snapshot",
    );
    const bytes = serializeItmCanonicalSnapshot(snapshot);
    const reparsed = itmParser.parse(bytes, parseOptions);
    if (reparsed.errors && reparsed.errors.length > 0) {
        throw new Error(`Canonical ITM snapshot did not round-trip: ${reparsed.errors[0]}`);
    }

    const reparsedSnapshot = createItmCanonicalSnapshot(reparsed);
    if (JSON.stringify(snapshot) !== JSON.stringify(reparsedSnapshot)) {
        throw new Error("Canonical ITM snapshot did not round-trip semantically");
    }

    return { snapshot, bytes, parseResult: reparsed };
}
