/**
 * Finds a file by name recursively under a directory tree.
 *
 * Shared helper (cmpStr) is in utils/yaml-helpers.
 */

import fs from "node:fs";
import path from "node:path";
import { cmpStr } from "../../../utils/src/yaml-helpers.ts";

/**
 * Finds a single file by name recursively under the given path.
 * Returns the full path or undefined if not found.
 */
export function findFile(dirPath: string, filename: string): string | undefined {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    entries.sort((a, b) => cmpStr(a.name, b.name));
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isFile() && entry.name === filename) {
            return fullPath;
        }
        if (entry.isDirectory()) {
            const found = findFile(fullPath, filename);
            if (found !== undefined) {
                return found;
            }
        }
    }
    return undefined;
}
