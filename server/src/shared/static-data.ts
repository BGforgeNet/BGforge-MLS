/**
 * Shared static data loading utilities.
 * Loads pre-generated JSON files for completion, hover, and signature data.
 * JSON files are generated from YAML by scripts/generate-data.sh (via generate-data.ts) on a data update,
 * and committed.
 */

import { readFileSync } from "fs";
import * as path from "path";
import { errorMessage } from "../diagnostics";
import { conlog } from "../logger";

/**
 * Load a static JSON data file for a given language.
 * A missing or unparsable file is logged as a warning naming the file, and degrades to no data.
 * @param type Data type: "completion", "hover", or "signature"
 * @param langId Language ID
 * @returns Parsed JSON data, or undefined on error
 */
export function loadStaticJson<T>(type: "completion" | "hover" | "signature", langId: string): T | undefined {
    // __dirname in bundled code points to server/out/
    const filePath = path.join(__dirname, `${type}.${langId}.json`);
    try {
        return JSON.parse(readFileSync(filePath, "utf-8")) as T;
    } catch (error) {
        conlog(`Failed to load static ${type} data for ${langId} from ${filePath}: ${errorMessage(error)}`, "warn");
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
