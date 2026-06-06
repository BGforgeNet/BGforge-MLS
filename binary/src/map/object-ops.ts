/**
 * Add/insert/remove/reorder/duplicate byte-builders for MAP objects.
 *
 * Objects are stored per-elevation (doc.objects.elevations[k].objects), so this
 * is N independent flat lists addressed by elevation - not the var-section int32
 * model and not CRE's owner+slice model. Each mutation: resolve the elevation
 * from the section name, mutate that elevation's array, recompute the per-
 * elevation objectCount + the document totalObjects, re-anchor the trailing
 * opaque range past the objects resize, and serialize.
 *
 * Objects are the last real section, so the only opaque range at or after the
 * objects-section start is the objects-tail (or script-section-tail) trailer;
 * shiftOpaqueRangesAfterObjects re-anchors it by the byte delta. Field-level
 * edits on decoded objects are width-preserving and do NOT go through here.
 */

import type { ParseOpaqueRange, ParseResult } from "../types";
import { applyEntryMutation } from "../spec/entity-ops";
import { getMapCanonicalDocument, rebuildMapCanonicalDocument } from "./canonical-reader";
import { mapObjectsSectionStart, objectsSerializedLength, serializeMapCanonicalDocument } from "./canonical-writer";
import { PID_TYPE_MISC, type MapCanonicalDocument } from "./canonical-schemas";

type MapObjects = MapCanonicalDocument["objects"];
type MapObject = MapObjects["elevations"][number]["objects"][number];

const ELEVATION_PREFIX = "Elevation ";
const ELEVATION_SUFFIX = " Objects";
const OBJECT_LABEL_RE = /^Object (\d+)\.(\d+) /;

// A blank object decodes deterministically with no PRO resolver: pidType MISC
// with an index below the exit-grid range (0x5000010..0x5000017), so the parser
// reads only base + inventory header + data flags. See parse-objects.ts and
// parse-helpers.ts:isExitGridPid.
const DEFAULT_OBJECT_PID = (PID_TYPE_MISC << 24) >>> 0; // 0x05000000

export function defaultMapObject(): MapObject {
    return {
        kind: "misc",
        base: {
            id: 0,
            tile: 0,
            x: 0,
            y: 0,
            screenX: 0,
            screenY: 0,
            frame: 0,
            rotation: 0,
            fid: 0,
            flags: [],
            elevation: 0,
            pid: DEFAULT_OBJECT_PID,
            cid: 0,
            lightDistance: 0,
            lightIntensity: 0,
            field74: 0,
            sid: 0,
            scriptIndex: 0,
        },
        inventoryHeader: { inventoryLength: 0, inventoryCapacity: 0, inventoryPointer: 0 },
        inventory: [],
    };
}

function readDocument(pr: ParseResult): MapCanonicalDocument | undefined {
    return getMapCanonicalDocument(pr) ?? rebuildMapCanonicalDocument(pr);
}

/**
 * Object structure ops are only safe when the objects section fully decoded.
 * An opaque `objects-tail` (or a `script-section-tail` that swallowed the
 * objects) means some objects live in undecoded bytes AND the decoded array's
 * last entry may itself be a partially-decoded object. Appending/removing
 * around an incomplete tail does not round-trip - on reparse the parser bails
 * at the incomplete object before it reaches the edit, so the new object lands
 * in the opaque region and the byte layout desyncs. Refuse the op rather than
 * risk silent corruption; field-level edits on decoded objects are unaffected.
 *
 * Two distinct incompleteness signals, both refused:
 *  - an opaque object tail (some objects undecoded), or
 *  - an object/elevation truncation error. A last object truncated exactly to
 *    EOF consumes every remaining byte, so NO opaque tail is emitted, yet the
 *    decoded array holds a partial object the writer would re-serialize at full
 *    width. The parser always reports a truncation error on that path.
 */
function objectsFullyDecoded(pr: ParseResult): boolean {
    const hasOpaqueObjectTail = (pr.opaqueRanges ?? []).some(
        (r) => (r.label === "objects-tail" || r.label === "script-section-tail") && r.size > 0,
    );
    const hasTruncationError = (pr.errors ?? []).some((e) => /truncated/i.test(e) && /object|elevation/i.test(e));
    return !hasOpaqueObjectTail && !hasTruncationError;
}

function parseElevation(section: string | undefined): number | undefined {
    if (section === undefined || !section.startsWith(ELEVATION_PREFIX) || !section.endsWith(ELEVATION_SUFFIX)) {
        return undefined;
    }
    const mid = section.slice(ELEVATION_PREFIX.length, section.length - ELEVATION_SUFFIX.length);
    const n = Number.parseInt(mid, 10);
    return Number.isInteger(n) && n >= 0 && n < 3 ? n : undefined;
}

function parseObjectIndex(label: string | undefined, elev: number): number | undefined {
    if (label === undefined) return undefined;
    const m = OBJECT_LABEL_RE.exec(label);
    if (!m) return undefined;
    if (Number.parseInt(m[1]!, 10) !== elev) return undefined;
    const idx = Number.parseInt(m[2]!, 10);
    return Number.isInteger(idx) && idx >= 0 ? idx : undefined;
}

/** Highest base.id across all top-level objects in every elevation, or -1 if none. */
function maxObjectId(objects: MapObjects): number {
    let max = -1;
    for (const elev of objects.elevations) {
        for (const o of elev.objects) {
            if (o.base.id > max) max = o.base.id;
        }
    }
    return max;
}

/** Write a new objects array for one elevation, adjusting objectCount + totalObjects by the net delta.
 *
 * objectCount is the raw wire count, which includes both decoded objects (elevation.objects) and
 * un-decoded objects stored in the trailing opaque range. Adding or removing one decoded object
 * changes the wire count by exactly 1; setting objectCount = next.length would corrupt the count
 * for elevations where some objects are opaque.
 */
function withElevationObjects(
    doc: MapCanonicalDocument,
    elev: number,
    next: readonly MapObject[],
): MapCanonicalDocument {
    const delta = next.length - doc.objects.elevations[elev]!.objects.length;
    const elevations = doc.objects.elevations.map((e, i) =>
        i === elev ? { ...e, objects: [...next], objectCount: e.objectCount + delta } : e,
    );
    const totalObjects = doc.objects.totalObjects + delta;
    return { ...doc, objects: { ...doc.objects, elevations, totalObjects } };
}

function shiftOpaqueRangesAfterObjects(
    opaqueRanges: ParseOpaqueRange[] | undefined,
    oldDoc: MapCanonicalDocument,
    delta: number,
): ParseOpaqueRange[] | undefined {
    if (!opaqueRanges || delta === 0) return opaqueRanges;
    const cutoff = mapObjectsSectionStart(oldDoc);
    return opaqueRanges.map((r) => (r.offset >= cutoff ? { ...r, offset: r.offset + delta } : r));
}

function serializeWithReanchor(
    pr: ParseResult,
    oldDoc: MapCanonicalDocument,
    newDoc: MapCanonicalDocument,
): Uint8Array {
    const delta = objectsSerializedLength(newDoc.objects) - objectsSerializedLength(oldDoc.objects);
    return serializeMapCanonicalDocument(newDoc, shiftOpaqueRangesAfterObjects(pr.opaqueRanges, oldDoc, delta));
}

interface ResolvedEntry {
    readonly doc: MapCanonicalDocument;
    readonly elev: number;
    readonly index: number;
    readonly current: readonly MapObject[];
}

function resolveEntry(pr: ParseResult, entryPath: readonly string[]): ResolvedEntry | undefined {
    if (entryPath.length !== 2) return undefined;
    const elev = parseElevation(entryPath[0]);
    if (elev === undefined) return undefined;
    const doc = readDocument(pr);
    if (!doc || !objectsFullyDecoded(pr)) return undefined;
    const current = doc.objects.elevations[elev]!.objects;
    const index = parseObjectIndex(entryPath[1], elev);
    if (index === undefined || index >= current.length) return undefined;
    return { doc, elev, index, current };
}

/** Set the object at `index` to a fresh unique base.id (max+1), preserving its pid. */
function freshenNewId(objects: readonly MapObject[], index: number, doc: MapCanonicalDocument): MapObject[] {
    const fresh = maxObjectId(doc.objects) + 1;
    return objects.map((o, i) => (i === index ? { ...o, base: { ...o.base, id: fresh } } : o));
}

export function buildMapObjectAddEntryBytes(pr: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined {
    if (arrayPath.length !== 1) return undefined;
    const elev = parseElevation(arrayPath[0]);
    if (elev === undefined) return undefined;
    const doc = readDocument(pr);
    if (!doc || !objectsFullyDecoded(pr)) return undefined;
    const current = doc.objects.elevations[elev]!.objects;
    const mutation = applyEntryMutation(current, "add", current.length, defaultMapObject);
    if (!mutation) return undefined;
    const newDoc = withElevationObjects(doc, elev, freshenNewId(mutation.next, mutation.index, doc));
    return serializeWithReanchor(pr, doc, newDoc);
}

export function buildMapObjectInsertEntryBytes(
    pr: ParseResult,
    entryPath: readonly string[],
    position: "before" | "after",
): Uint8Array | undefined {
    const r = resolveEntry(pr, entryPath);
    if (!r) return undefined;
    const mutation = applyEntryMutation(r.current, "insert", r.index, defaultMapObject, position);
    if (!mutation) return undefined;
    const newDoc = withElevationObjects(r.doc, r.elev, freshenNewId(mutation.next, mutation.index, r.doc));
    return serializeWithReanchor(pr, r.doc, newDoc);
}

export function buildMapObjectRemoveEntryBytes(pr: ParseResult, entryPath: readonly string[]): Uint8Array | undefined {
    const r = resolveEntry(pr, entryPath);
    if (!r) return undefined;
    const mutation = applyEntryMutation(r.current, "remove", r.index, defaultMapObject);
    if (!mutation) return undefined;
    const newDoc = withElevationObjects(r.doc, r.elev, mutation.next);
    return serializeWithReanchor(pr, r.doc, newDoc);
}

export function buildMapObjectMoveEntryBytes(
    pr: ParseResult,
    entryPath: readonly string[],
    direction: "up" | "down",
): Uint8Array | undefined {
    const r = resolveEntry(pr, entryPath);
    if (!r) return undefined;
    const mutation = applyEntryMutation(r.current, "reorder", r.index, defaultMapObject, undefined, direction);
    if (!mutation) return undefined; // boundary no-op
    const newDoc = withElevationObjects(r.doc, r.elev, mutation.next);
    return serializeWithReanchor(pr, r.doc, newDoc);
}

export function buildMapObjectDuplicateEntryBytes(
    pr: ParseResult,
    entryPath: readonly string[],
): Uint8Array | undefined {
    const r = resolveEntry(pr, entryPath);
    if (!r) return undefined;
    // Deep clone so nested inventory objects are independent; preserve pid (proto
    // reference), freshen base.id (max+1) so the clone aliases no existing object.
    // sid/scriptIndex are copied verbatim (the clone shares the original's script;
    // duplicating the linked script is out of scope - see design section 8).
    const clone = structuredClone(r.current[r.index]!) as MapObject;
    clone.base.id = maxObjectId(r.doc.objects) + 1;
    const next = [...r.current.slice(0, r.index + 1), clone, ...r.current.slice(r.index + 1)];
    const newDoc = withElevationObjects(r.doc, r.elev, next);
    return serializeWithReanchor(pr, r.doc, newDoc);
}

export function isMapObjectListSection(arrayPath: readonly string[]): boolean {
    return arrayPath.length === 1 && parseElevation(arrayPath[0]) !== undefined;
}

export function isMapObjectModifiableArray(arrayPath: readonly string[]): boolean {
    return isMapObjectListSection(arrayPath);
}

export function isMapObjectAddableArray(arrayPath: readonly string[]): boolean {
    return isMapObjectListSection(arrayPath);
}

export function isMapObjectRemovableEntry(entryPath: readonly string[]): boolean {
    if (entryPath.length !== 2) return false;
    const elev = parseElevation(entryPath[0]);
    return elev !== undefined && parseObjectIndex(entryPath[1], elev) !== undefined;
}
