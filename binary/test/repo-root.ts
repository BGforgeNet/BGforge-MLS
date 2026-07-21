/**
 * Root of the repository, anchored to this file's own location so fixture
 * paths resolve the same whether vitest runs from the repo root or from
 * binary/ (unlike a bare `path.resolve("client/testFixture/...")`, which
 * resolves against `process.cwd()` and silently misses fixtures - or worse,
 * matches an unrelated directory - when the cwd differs).
 */

import * as path from "path";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
