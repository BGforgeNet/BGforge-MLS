import {
    createSplCanonicalSnapshot,
    splCanonicalSnapshotSchemaPermissive,
    serializeSplCanonicalSnapshot,
    type SplCanonicalSnapshot,
} from "./canonical";
import { splParser } from "./index";
import { parseWithSchemaValidation } from "../schema-validation";
import type { ParseOptions, ParseResult } from "../types";

interface LoadedCanonicalSplSnapshot {
    readonly snapshot: SplCanonicalSnapshot;
    readonly bytes: Uint8Array;
    readonly parseResult: ParseResult;
}

export function createCanonicalSplJsonSnapshot(parseResult: ParseResult): string {
    return `${JSON.stringify(createSplCanonicalSnapshot(parseResult), null, 2)}\n`;
}

export function loadCanonicalSplJsonSnapshot(
    jsonText: string,
    parseOptions?: ParseOptions,
): LoadedCanonicalSplSnapshot {
    const snapshot = parseWithSchemaValidation(
        splCanonicalSnapshotSchemaPermissive,
        JSON.parse(jsonText),
        "Invalid canonical SPL snapshot",
    );
    const bytes = serializeSplCanonicalSnapshot(snapshot);
    const reparsed = splParser.parse(bytes, parseOptions);
    if (reparsed.errors && reparsed.errors.length > 0) {
        throw new Error(`Canonical SPL snapshot did not round-trip: ${reparsed.errors[0]}`);
    }

    const reparsedSnapshot = createSplCanonicalSnapshot(reparsed);
    if (JSON.stringify(snapshot) !== JSON.stringify(reparsedSnapshot)) {
        throw new Error("Canonical SPL snapshot did not round-trip semantically");
    }

    return { snapshot, bytes, parseResult: reparsed };
}
