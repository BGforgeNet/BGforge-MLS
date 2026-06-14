/**
 * MAP cross-record jump links: a script's `Owner ID` references the object that owns it (the object's `id`),
 * and an object's `SID` references the script it runs (the script slot's own `sid`). This overlay resolves
 * those references to the target entry node so the view can render a click-to-navigate affordance.
 *
 * The reverse fields are NOT links: a script's own `SID` is its identity (not a reference), and an object's
 * `ID` is its identity. Only `Owner ID` (always a script field - objects have none) and an object-entry `SID`
 * produce a link.
 *
 * Indices are built once per model and memoized (a heavily-scripted map has thousands of scripts/objects, so
 * rebuilding per field would be quadratic). A mutation produces a fresh Model, which misses the WeakMap and
 * rebuilds.
 */

import type { ParsedField } from "@bgforge/binary";
import type { FlatNode, Model } from "../model";
import type { NodeId } from "../types";
import type { FieldOverride } from "./types";

/** The stored numeric value of a field node (the i32/u32 behind id/sid/ownerId), or undefined. */
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
    /** object `id` value -> object entry node. */
    objectsById: Map<number, LinkTarget>;
    /** script `sid` value -> script entry node. */
    scriptsBySid: Map<number, LinkTarget>;
    /** Entry nodes that are objects - used to tell an object `SID` (a link) from a script `SID` (identity). */
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
    const objectsById = new Map<number, LinkTarget>();
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
            if (isObjects) {
                objectEntries.add(entry.id);
                const id = childFieldValue(model, entry, "ID");
                // First entry wins: object ids are unique in a well-formed map; a duplicate is malformed.
                if (id !== undefined && !objectsById.has(id)) {
                    objectsById.set(id, { nodeId: entry.id, sectionKey: section.name, label: entry.name });
                }
            } else {
                const sid = childFieldValue(model, entry, "SID");
                if (sid !== undefined && !scriptsBySid.has(sid)) {
                    scriptsBySid.set(sid, { nodeId: entry.id, sectionKey: section.name, label: entry.name });
                }
            }
        }
    }
    return { objectsById, scriptsBySid, objectEntries };
}

function getIndex(model: Model): MapLinkIndex {
    let idx = cache.get(model);
    if (idx === undefined) {
        idx = buildIndex(model);
        cache.set(model, idx);
    }
    return idx;
}

/** Resolve a MAP cross-record jump for the script `Owner ID` and object `SID` fields. */
export function mapLinkFieldOverride(model: Model, node: FlatNode): FieldOverride | undefined {
    const value = numericValue(node);
    if (value === undefined) return undefined;

    // Owner ID is a script field only (objects have none), so the name alone identifies the script->object ref.
    if (node.name === "Owner ID") {
        const target = getIndex(model).objectsById.get(value);
        return target
            ? { link: { targetNodeId: target.nodeId, sectionKey: target.sectionKey, label: target.label } }
            : undefined;
    }

    // SID is ambiguous: an object's SID references its script (a link); a script's own SID is its identity (not).
    if (node.name === "SID" && node.parentId !== undefined) {
        const idx = getIndex(model);
        if (!idx.objectEntries.has(node.parentId)) return undefined;
        const target = idx.scriptsBySid.get(value);
        return target
            ? { link: { targetNodeId: target.nodeId, sectionKey: target.sectionKey, label: target.label } }
            : undefined;
    }

    return undefined;
}
