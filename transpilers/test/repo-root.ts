/**
 * Root of the repository, anchored to this file's own location so paths into
 * `transpilers/out/` or sibling packages (server/test/td/samples) resolve the
 * same whether vitest runs from the repo root or from transpilers/ - unlike a
 * bare `path.resolve("transpilers/...")`, which resolves against `process.cwd()`.
 */

import * as path from "path";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
