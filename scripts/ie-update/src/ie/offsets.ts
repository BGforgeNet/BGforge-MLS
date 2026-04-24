/**
 * IESDP file format offset processing.
 * Handles prefix generation, offset ID construction, size calculation,
 * validation, and definition file generation from IESDP offset data.
 */

import type { OffsetItem } from "./types.ts";

/** Map of offset type names to their byte sizes */
const SIZE_MAP: Readonly<Record<string, number>> = {
    byte: 1,
    char: 1,
    word: 2,
    dword: 4,
    resref: 8,
    strref: 4,
};

/** Custom replacements applied during string-to-id conversion */
const ID_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
    ["probability ", "probability"],
    ["usability ", "usability"],
    ["parameter ", "parameter"],
    ["resource ", "resource"],
    ["alternative", "alt"],
    [".", ""],
];

/**
 * Generates an offset prefix from file version and data file name.
 * Example: ("itm_v2", "header.yml") -> "ITM_V2_"
 *          ("eff_v1", "body.yml") -> "EFF_"
 */
export function getOffsetPrefix(fileVersion: string, dataFileName: string): string {
    const base = fileVersion.replace(/_v.*/, "");
    let version = fileVersion.replace(/.*_v/, "");
    version = version.replaceAll(".", "");
    if (version === "1") {
        version = "";
    }

    const fbase = dataFileName.replace(".yml", "");
    const fbaseMap: Readonly<Record<string, string>> = {
        header: "",
        body: "",
        extended_header: "head",
    };
    // Safe: fbase checked via `in` operator above
    const suffix = fbase in fbaseMap ? fbaseMap[fbase]! : fbase;

    let prefix = `${base}${version}_`;
    if (suffix !== "") {
        prefix = `${prefix}${suffix}_`;
    }
    return prefix.toUpperCase();
}

/**
 * Simplifies file format version for IElib directory naming.
 * Example: "eff_v2" -> "eff2", "itm_v1" -> "itm"
 */
export function getFormatVersion(fileVersion: string): string {
    const base = fileVersion.replace(/_v.*/, "");
    let version = fileVersion.replace(/.*_v/, "");
    version = version.replaceAll(".", "");
    if (version === "1") {
        version = "";
    }
    return `${base}${version}`;
}

/**
 * Gets or generates an ID for an offset item.
 * Uses the item's custom 'id' field if present, otherwise constructs from description.
 */
export function getOffsetId(item: OffsetItem, prefix: string): string {
    if (item.id !== undefined) {
        return prefix + item.id;
    }
    return stringToId(item.desc, prefix);
}

/**
 * Converts a description string to a valid define identifier.
 * Strips markdown links, applies custom replacements, and validates the result.
 */
export function stringToId(line: string, prefix: string): string {
    let iid = line.toLowerCase();

    // Strip markdown links: [text](url) -> text
    iid = iid.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    // Strip any remaining HTML tags
    iid = iid.replace(/<[^>]+>/g, "");

    for (const [orig, repl] of ID_REPLACEMENTS) {
        iid = iid.replaceAll(orig, repl);
    }

    iid = iid.replaceAll(" ", "_");
    iid = prefix + iid;

    if (/^[a-zA-Z0-9_]+$/.test(iid)) {
        return iid;
    }

    throw new Error(`Bad id: "${iid}". Aborting.`);
}

/**
 * Calculates the byte size of an offset item.
 * Uses explicit 'length' if present, otherwise derives from type and multiplier.
 */
export function getOffsetSize(item: OffsetItem): number {
    if (item.length !== undefined) {
        return item.length;
    }
    const size = SIZE_MAP[item.type];
    if (size === undefined) {
        throw new Error(`Unknown offset type: ${item.type}`);
    }
    if (item.mult !== undefined) {
        return size * item.mult;
    }
    return size;
}

/**
 * Validates that the current tracked offset matches the item's declared offset.
 * Throws on mismatch, indicating a bug in the source data.
 */
export function validateOffset(currentOffset: number, item: OffsetItem): void {
    if (item.offset !== undefined && item.offset !== currentOffset) {
        throw new Error(`Offset mismatch. Expected ${currentOffset}, got ${item.offset} for ${JSON.stringify(item)}`);
    }
}

/**
 * Checks whether an offset item should be skipped (unused or unknown).
 */
export function offsetIsUnused(offset: OffsetItem): boolean {
    if (offset.unused !== undefined || offset.unknown !== undefined) {
        return true;
    }
    if (offset.desc.toLowerCase() === "unknown") {
        return true;
    }
    return false;
}

/**
 * Converts an array of offset items to a definition map of id -> hex value.
 * Skips unused/unknown items. Validates offsets along the way.
 */
export function offsetsToDefinition(data: readonly OffsetItem[], prefix: string): Map<string, string> {
    const firstItem = data[0];
    if (firstItem === undefined) {
        return new Map();
    }

    let curOff = firstItem.offset ?? 0;
    const items = new Map<string, string>();

    for (const item of data) {
        validateOffset(curOff, item);
        const size = getOffsetSize(item);

        if (offsetIsUnused(item)) {
            curOff += size;
            continue;
        }

        const iid = getOffsetId(item, prefix);
        items.set(iid, `0x${curOff.toString(16)}`);
        curOff += size;
    }

    return items;
}
