import {
    createEffCanonicalSnapshot,
    effCanonicalSnapshotSchemaPermissive,
    serializeEffCanonicalSnapshot,
    type EffCanonicalSnapshot,
} from "./canonical";
import { effParser } from "./index";
import { parseWithSchemaValidation } from "../schema-validation";
import type { ParseOptions, ParseResult } from "../types";

interface LoadedCanonicalEffSnapshot {
    readonly snapshot: EffCanonicalSnapshot;
    readonly bytes: Uint8Array;
    readonly parseResult: ParseResult;
}

export function createCanonicalEffJsonSnapshot(parseResult: ParseResult): string {
    return `${JSON.stringify(createEffCanonicalSnapshot(parseResult), null, 2)}\n`;
}

export function loadCanonicalEffJsonSnapshot(
    jsonText: string,
    parseOptions?: ParseOptions,
): LoadedCanonicalEffSnapshot {
    const snapshot = parseWithSchemaValidation(
        effCanonicalSnapshotSchemaPermissive,
        JSON.parse(jsonText),
        "Invalid canonical EFF snapshot",
    );
    const bytes = serializeEffCanonicalSnapshot(snapshot);
    const reparsed = effParser.parse(bytes, parseOptions);
    if (reparsed.errors && reparsed.errors.length > 0) {
        throw new Error(`Canonical EFF snapshot did not round-trip: ${reparsed.errors[0]}`);
    }

    const reparsedSnapshot = createEffCanonicalSnapshot(reparsed);
    if (JSON.stringify(snapshot) !== JSON.stringify(reparsedSnapshot)) {
        throw new Error("Canonical EFF snapshot did not round-trip semantically");
    }

    return { snapshot, bytes, parseResult: reparsed };
}
