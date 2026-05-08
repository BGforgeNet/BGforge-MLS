/**
 * Shared static data loading utilities.
 * Loads pre-generated JSON files for completion, hover, and signature data.
 * JSON files are generated from YAML by scripts/generate_data.py at build time.
 */

import { readFileSync } from "fs";
import * as path from "path";
import { conlog } from "../common";

/**
 * Load a static JSON data file for a given language.
 * Internal helper for loadStaticMap - not exported as it's only used internally.
 * @param type Data type: "completion", "hover", or "signature"
 * @param langId Language ID
 * @returns Parsed JSON data, or undefined on error
 */
function loadStaticJson<T>(type: "completion" | "hover" | "signature", langId: string): T | undefined {
    try {
        // __dirname in bundled code points to server/out/
        const filePath = path.join(__dirname, `${type}.${langId}.json`);
        return JSON.parse(readFileSync(filePath, "utf-8")) as T;
    } catch (error) {
        conlog(`Failed to load static ${type} data for ${langId}: ${error}`);
        return undefined;
    }
}

/**
 * Load static data and convert to Map.
 * Used for hover and signature data which are stored as objects but used as Maps.
 */
export function loadStaticMap<V>(type: "hover" | "signature", langId: string): Map<string, V> {
    const data = loadStaticJson<Record<string, V>>(type, langId);
    if (data) {
        return new Map(Object.entries(data));
    }
    return new Map();
}
