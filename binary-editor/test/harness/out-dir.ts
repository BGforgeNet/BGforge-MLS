import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Repo-level tmp/ for harness screenshots, keeping the source tree clean (project convention).
// This module lives in binary-editor/test/harness/, so the repo root is three levels up.
const here = path.dirname(fileURLToPath(import.meta.url));
export const SHOT_DIR = path.resolve(here, "../../../tmp");
mkdirSync(SHOT_DIR, { recursive: true });

/** Absolute path for a harness screenshot, under the repo tmp/ dir. */
export function shotPath(name: string): string {
    return path.join(SHOT_DIR, name);
}
