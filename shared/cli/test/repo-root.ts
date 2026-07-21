/**
 * Root of the repository, anchored to this file's own location so fixture and
 * scratch paths resolve the same whether vitest runs from the repo root or
 * elsewhere - unlike a bare `path.resolve("shared/...")` or `path.resolve("tmp/...")`,
 * which resolves against `process.cwd()`.
 */

import * as path from "path";

export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
