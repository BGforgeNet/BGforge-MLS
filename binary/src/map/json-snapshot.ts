import { mapParser } from "./index";
import {
    createMapCanonicalSnapshot,
    mapCanonicalSnapshotSchema,
    serializeMapCanonicalDocument,
    type MapCanonicalSnapshot,
} from "./canonical";
import { parseWithSchemaValidation } from "../schema-validation";
import type { ParseOptions, ParseResult } from "../types";

interface LoadedCanonicalMapSnapshot {
    readonly snapshot: MapCanonicalSnapshot;
    readonly bytes: Uint8Array;
    readonly parseResult: ParseResult;
}

function hasOpaqueRange(snapshot: MapCanonicalSnapshot, label: string): boolean {
    return (snapshot.opaqueRanges ?? []).some((range) => range.label === label);
}

function normalizeMapSnapshotForPersistence(snapshot: MapCanonicalSnapshot): MapCanonicalSnapshot {
    if (hasOpaqueRange(snapshot, "tiles")) {
        return snapshot;
    }

    const bytes = serializeMapCanonicalDocument(snapshot.document, snapshot.opaqueRanges);
    const reparsed = mapParser.parse(bytes, {
        skipMapTiles: true,
        gracefulMapBoundaries: hasOpaqueRange(snapshot, "objects-tail"),
    });
    if (reparsed.errors && reparsed.errors.length > 0) {
        throw new Error(`Canonical MAP snapshot normalization failed: ${reparsed.errors[0]}`);
    }

    const normalized = createMapCanonicalSnapshot(reparsed);
    if (!hasOpaqueRange(normalized, "tiles")) {
        throw new Error("Canonical MAP snapshot normalization failed: missing opaque tiles range");
    }
    return normalized;
}

function ensureSupportedMapSnapshotEncoding(snapshot: MapCanonicalSnapshot): void {
    if (!hasOpaqueRange(snapshot, "tiles")) {
        throw new Error("Unsupported MAP snapshot encoding: decoded tiles are not supported");
    }
}

export function createCanonicalMapJsonSnapshot(parseResult: ParseResult): string {
    const snapshot = normalizeMapSnapshotForPersistence(createMapCanonicalSnapshot(parseResult));
    return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function loadCanonicalMapJsonSnapshot(
    jsonText: string,
    _parseOptions?: ParseOptions,
): LoadedCanonicalMapSnapshot {
    const snapshot = parseWithSchemaValidation(
        mapCanonicalSnapshotSchema,
        JSON.parse(jsonText),
        "Invalid canonical MAP snapshot",
    );
    ensureSupportedMapSnapshotEncoding(snapshot);
    const bytes = serializeMapCanonicalDocument(snapshot.document, snapshot.opaqueRanges);
    const effectiveParseOptions: ParseOptions = {
        gracefulMapBoundaries: hasOpaqueRange(snapshot, "objects-tail"),
        skipMapTiles: true,
    };
    const reparsed = mapParser.parse(bytes, effectiveParseOptions);
    if (reparsed.errors && reparsed.errors.length > 0) {
        throw new Error(`Canonical MAP snapshot did not round-trip: ${reparsed.errors[0]}`);
    }

    const reparsedSnapshot = createMapCanonicalSnapshot(reparsed);
    if (JSON.stringify(snapshot) !== JSON.stringify(reparsedSnapshot)) {
        throw new Error("Canonical MAP snapshot did not round-trip semantically");
    }

    return { snapshot, bytes, parseResult: reparsed };
}
