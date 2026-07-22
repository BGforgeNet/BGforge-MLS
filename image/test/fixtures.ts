import fs from "fs";
import path from "path";

// Repo root is two levels up from image/test/.
const REPO_ROOT = path.resolve(__dirname, "../..");
export const FALLOUT_ART = path.join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/data/art");
export const IE_CORPUS = path.join(REPO_ROOT, "external/infinity-engine");

function walk(dir: string, ext: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full, ext));
        else if (entry.name.toLowerCase().endsWith(ext.toLowerCase())) out.push(full);
    }
    return out.sort();
}

export function corpusFiles(rootDir: string, ext: string): string[] {
    return walk(rootDir, ext);
}
