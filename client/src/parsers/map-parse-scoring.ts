/**
 * Scoring and confidence helpers used by MapParser to choose the best
 * script/object boundary candidate when gracefulMapBoundaries is enabled.
 */

import type { ParsedGroup } from "./types";
import {
    makeGroup,
    noteField,
    fieldNumber,
    PID_TYPE_MISC,
} from "./map-parse-helpers";

export function findFirstObjectGroup(group: ParsedGroup): ParsedGroup | undefined {
    for (const entry of group.fields) {
        if (!("fields" in entry)) {
            continue;
        }

        if (/^Object \d+\.\d+ /.test(entry.name)) {
            return entry;
        }

        const nested = findFirstObjectGroup(entry);
        if (nested) {
            return nested;
        }
    }

    return undefined;
}

export function buildOpaqueObjectsGroup(offset: number): ParsedGroup {
    return makeGroup("Objects Section", [
        { name: "Total Objects", value: 0, offset, size: 0, type: "int32" as const },
        makeGroup("Elevation 0 Objects", [{ name: "Object Count", value: 0, offset: offset + 4, size: 0, type: "int32" as const }]),
        makeGroup("Elevation 1 Objects", [{ name: "Object Count", value: 0, offset: offset + 8, size: 0, type: "int32" as const }]),
        makeGroup("Elevation 2 Objects", [{ name: "Object Count", value: 0, offset: offset + 12, size: 0, type: "int32" as const }]),
        noteField(
            "TODO",
            `Unable to confidently decode object section: script/object boundary is ambiguous near offset 0x${offset.toString(16)}; preserving remaining bytes opaquely`,
            offset
        ),
    ]);
}

export function objectCountNumbers(objectsGroup: ParsedGroup): number[] {
    return objectsGroup.fields
        .filter((entry): entry is ParsedGroup => "fields" in entry && /^Elevation \d+ Objects$/.test(entry.name))
        .map((entry) => fieldNumber(entry, "Object Count"))
        .filter((value): value is number => value !== undefined);
}

export function hasTodoNote(group: ParsedGroup): boolean {
    return group.fields.some((entry) => !("fields" in entry) && entry.name === "TODO");
}

export function isConfidentObjectsGroup(objectsGroup: ParsedGroup): boolean {
    const totalObjectsEntry = objectsGroup.fields.find((entry) => !("fields" in entry) && entry.name === "Total Objects");
    const totalObjects = totalObjectsEntry && !("fields" in totalObjectsEntry) && typeof totalObjectsEntry.value === "number"
        ? totalObjectsEntry.value
        : undefined;

    if (totalObjects === undefined || totalObjects < 0) {
        return false;
    }

    const objectCounts = objectCountNumbers(objectsGroup);
    if (objectCounts.length === 0 || objectCounts.some((value) => value < 0 || value > totalObjects)) {
        return false;
    }

    const parsedCountSum = objectCounts.reduce((sum, value) => sum + value, 0);
    if (parsedCountSum > totalObjects) {
        return false;
    }

    const firstObject = findFirstObjectGroup(objectsGroup);
    if (!firstObject) {
        return totalObjects === 0 && !hasTodoNote(objectsGroup);
    }

    const rotation = fieldNumber(firstObject, "Rotation");
    const elevation = fieldNumber(firstObject, "Elevation");
    const pid = fieldNumber(firstObject, "PID");

    if (rotation === undefined || rotation < 0 || rotation > 5) {
        return false;
    }

    if (elevation === undefined || elevation < 0 || elevation > 2) {
        return false;
    }

    if (pid === undefined) {
        return false;
    }

    const pidType = (pid >>> 24) & 0xFF;
    return pid === -1 || pidType <= PID_TYPE_MISC;
}

export function scoreParsedTail(
    scriptTypeCount: number,
    scriptErrors: string[],
    objectsGroup: ParsedGroup
): number {
    let score = -scriptErrors.length * 100_000;
    score += (6 - scriptTypeCount) * 5;

    const totalObjectsEntry = objectsGroup.fields.find((entry) => !("fields" in entry) && entry.name === "Total Objects");
    const totalObjects = totalObjectsEntry && !("fields" in totalObjectsEntry) && typeof totalObjectsEntry.value === "number"
        ? totalObjectsEntry.value
        : undefined;

    if (totalObjects !== undefined && totalObjects >= 0) {
        score += 50;
    }

    if (totalObjects === 0) {
        score += 25;
    }

    const objectCounts = objectCountNumbers(objectsGroup);
    const parsedCountSum = objectCounts.reduce((sum, value) => sum + value, 0);

    if (objectCounts.every((value) => value >= 0)) {
        score += 30;
    } else {
        score -= 400;
    }

    if (totalObjects !== undefined) {
        if (objectCounts.some((value) => value > totalObjects)) {
            score -= 1500;
        } else {
            score += 50;
        }

        if (parsedCountSum > totalObjects) {
            score -= 1500;
        } else {
            score += 25;
        }
    }

    const firstObject = findFirstObjectGroup(objectsGroup);
    if (!firstObject) {
        if (totalObjects === 0) {
            score += 125;
        }
        return score;
    }

    if (!firstObject.name.includes("Type")) {
        score += 100;
    }

    const rotation = fieldNumber(firstObject, "Rotation");
    if (rotation !== undefined) {
        score += rotation >= 0 && rotation <= 5 ? 40 : -250;
    }

    const elevation = fieldNumber(firstObject, "Elevation");
    if (elevation !== undefined) {
        score += elevation >= 0 && elevation <= 2 ? 40 : -175;
    }

    const pid = fieldNumber(firstObject, "PID");
    if (pid !== undefined) {
        const pidType = (pid >>> 24) & 0xFF;
        score += pid === -1 || pidType <= PID_TYPE_MISC ? 40 : -175;
    }

    const sid = fieldNumber(firstObject, "SID");
    if (sid !== undefined) {
        score += sid >= -1 ? 10 : -10;
    }

    return score;
}

