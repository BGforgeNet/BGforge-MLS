/**
 * Root of the repository, anchored to this file's own location so paths into
 * `client/` or repo-root files (package.json, themes/) resolve the same
 * whether vitest runs from the repo root or from client/ - unlike a bare
 * `path.resolve("client/...")`, which resolves against `process.cwd()`.
 */

import * as path from "path";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
