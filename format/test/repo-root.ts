/**
 * Root of the repository, anchored to this file's own location so paths into
 * `format/out/` or sibling packages (grammars/) resolve the same whether
 * vitest runs from the repo root or from format/ - unlike a bare
 * `path.resolve("format/...")`, which resolves against `process.cwd()`.
 */

import * as path from "path";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
