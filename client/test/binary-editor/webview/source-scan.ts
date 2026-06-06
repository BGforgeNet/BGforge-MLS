import fs from "node:fs";
import path from "node:path";

// Recursively list source files under `dir`. The webview guard tests use this to scan source in-process
// instead of shelling out to `rg`, which is a developer-environment tool that is not installed in CI.
export function listSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listSourceFiles(full));
        else if (/\.(ts|mts|cts|js|mjs|svelte)$/.test(entry.name)) out.push(full);
    }
    return out;
}
