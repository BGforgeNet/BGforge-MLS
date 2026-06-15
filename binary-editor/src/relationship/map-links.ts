/**
 * MAP cross-record jump links, both driven by the authoritative `sid` binding: an object's `SID` field names
 * the script it runs, and that same value is the script's own `SID`. So the two records are linked by a shared
 * sid - the object that runs a script is exactly the object whose `SID` equals the script's `SID`.
 *
 *   - object's SID field  -> the script with that sid (scriptsBySid).
 *   - script's SID field  -> the object that references it, i.e. whose SID equals this script's sid (objectsBySid).
 *
 * The script's `Owner ID` (scr_oid) is deliberately NOT used: it is engine runtime state cached at bind time
 * and is frequently stale or wrong on disk (e.g. Broken Hills' map has Owner IDs pointing at unrelated objects
 * of the wrong type), whereas the object<->script `sid` reference is authored and reliable.
 *
 * Indices are built once per model and memoized (a heavily-scripted map has thousands of records, so rebuilding
 * per field would be quadratic). A mutation produces a fresh Model, which misses the WeakMap and rebuilds.
 */

import type { ParsedField } from "@bgforge/binary";
import type { FlatNode, Model } from "../model";
import type { NodeId } from "../types";
import type { FieldOverride } from "./types";

/** The stored numeric value of a field node (the i32/u32 behind id/sid), or undefined. */
function numericValue(node: FlatNode): number | undefined {
    if (node.kind !== "field") return undefined;
    const field = node.source as ParsedField;
    const v = typeof field.value === "number" ? field.value : field.rawValue;
    return typeof v === "number" ? v : undefined;
}

interface LinkTarget {
    nodeId: NodeId;
    /** The target entry's list section (e.g. "Item Scripts", "Elevation 0 Objects") - the view maps it to a tab. */
    sectionKey: string;
    label: string;
}

interface MapLinkIndex {
    /** object `sid` value -> object entry (the object that runs the script with that sid). */
    objectsBySid: Map<number, LinkTarget>;
    /** script `sid` value -> script entry. */
    scriptsBySid: Map<number, LinkTarget>;
    /** Entry nodes that are objects - used to tell an object `SID` (-> script) from a script `SID` (-> object). */
    objectEntries: Set<NodeId>;
}

const cache = new WeakMap<Model, MapLinkIndex>();

/** The numeric value of a named direct-child field of `entry`, or undefined. */
function childFieldValue(model: Model, entry: FlatNode, fieldName: string): number | undefined {
    for (const i of model.childrenByParent.get(entry.id) ?? []) {
        const child = model.nodes[i]!;
        if (child.kind === "field" && child.name === fieldName) {
            const v = numericValue(child);
            if (v !== undefined) return v;
        }
    }
    return undefined;
}

function buildIndex(model: Model): MapLinkIndex {
    const objectsBySid = new Map<number, LinkTarget>();
    const scriptsBySid = new Map<number, LinkTarget>();
    const objectEntries = new Set<NodeId>();

    for (const sectionIdx of model.childrenByParent.get("") ?? []) {
        const section = model.nodes[sectionIdx]!;
        if (section.kind !== "group") continue;
        // Flattened sections are named "<Type> Scripts" and "Elevation N Objects".
        const isObjects = section.name.endsWith("Objects");
        const isScripts = section.name.endsWith("Scripts");
        if (!isObjects && !isScripts) continue;

        for (const entryIdx of model.childrenByParent.get(section.id) ?? []) {
            const entry = model.nodes[entryIdx]!;
            if (entry.kind !== "group") continue;
            const sid = childFieldValue(model, entry, "SID");
            const target = { nodeId: entry.id, sectionKey: section.name, label: entry.name };
            if (isObjects) {
                objectEntries.add(entry.id);
                // -1 means the object runs no script; first valid sid wins (a well-formed map's refs are unique).
                if (sid !== undefined && sid !== -1 && !objectsBySid.has(sid)) objectsBySid.set(sid, target);
            } else if (sid !== undefined && !scriptsBySid.has(sid)) {
                scriptsBySid.set(sid, target);
            }
        }
    }
    return { objectsBySid, scriptsBySid, objectEntries };
}

function getIndex(model: Model): MapLinkIndex {
    let idx = cache.get(model);
    if (idx === undefined) {
        idx = buildIndex(model);
        cache.set(model, idx);
    }
    return idx;
}

/** Resolve a MAP cross-record jump for the SID field of a script (-> its object) or an object (-> its script). */
export function mapLinkFieldOverride(model: Model, node: FlatNode): FieldOverride | undefined {
    if (node.name !== "SID" || node.parentId === undefined) return undefined;
    const value = numericValue(node);
    if (value === undefined) return undefined;

    const idx = getIndex(model);
    // An object's SID names the script it runs; a script's SID is its own id, resolving to the object that runs it.
    const target = idx.objectEntries.has(node.parentId) ? idx.scriptsBySid.get(value) : idx.objectsBySid.get(value);
    return target
        ? { link: { targetNodeId: target.nodeId, sectionKey: target.sectionKey, label: target.label } }
        : undefined;
}
