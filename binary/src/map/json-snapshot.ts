import { mapParser } from "./index";
import {
    createMapCanonicalSnapshot,
    mapCanonicalSnapshotSchema,
    serializeMapCanonicalDocument,
    type MapCanonicalSnapshot,
} from "./canonical";
import type { MapCanonicalDocument } from "./canonical-schemas";
import { parseWithSchemaValidation } from "../schema-validation";
import type { PidResolver } from "../pid-resolver";
import type { ParseOptions, ParseResult } from "../types";

interface LoadedCanonicalMapSnapshot {
    readonly snapshot: MapCanonicalSnapshot;
    readonly bytes: Uint8Array;
    readonly parseResult: ParseResult;
}

function hasOpaqueRange(snapshot: MapCanonicalSnapshot, label: string): boolean {
    return (snapshot.opaqueRanges ?? []).some((range) => range.label === label);
}

/**
 * Build a `pid → subType` resolver from a canonical document. Walks every
 * object (including nested inventory items) and indexes the `subtypeData`
 * entries the original parse decoded. Used to seed snapshot reparse with
 * the same resolution the original parse had, without re-consulting the
 * filesystem-backed loader.
 */
function buildResolverFromDocument(doc: MapCanonicalDocument): PidResolver {
    const map = new Map<number, number>();
    function walk(objects: MapCanonicalDocument["objects"]["elevations"][number]["objects"]): void {
        for (const obj of objects) {
            if (obj.subtypeData) map.set(obj.base.pid, obj.subtypeData.subType);
            walk(obj.inventory.map((entry) => entry.object));
        }
    }
    for (const elevation of doc.objects.elevations) walk(elevation.objects);
    return (pid) => map.get(pid);
}

function normalizeMapSnapshotForPersistence(snapshot: MapCanonicalSnapshot): MapCanonicalSnapshot {
    if (hasOpaqueRange(snapshot, "tiles")) {
        return snapshot;
    }

    const bytes = serializeMapCanonicalDocument(snapshot.document, snapshot.opaqueRanges);
    const reparsed = mapParser.parse(bytes, {
        skipMapTiles: true,
        gracefulMapBoundaries: hasOpaqueRange(snapshot, "objects-tail"),
        pidResolver: buildResolverFromDocument(snapshot.document),
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
        pidResolver: buildResolverFromDocument(snapshot.document),
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
