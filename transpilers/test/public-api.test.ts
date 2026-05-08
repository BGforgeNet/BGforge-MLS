/**
 * Pins the public surface of @bgforge/transpile against the symbols its
 * consumers (BGforge MLS server providers, fgtp CLI, plugin packages)
 * actually import. Adding a new public symbol requires extending this
 * list; removing one fails this test before downstream callers see the
 * break.
 *
 * api.test.ts covers behavior of these exports; this file covers their
 * presence.
 */

import { describe, it, expect } from "vitest";
import * as transpile from "../src/index";

const REQUIRED_VALUE_EXPORTS = [
    // Per-language transpilers
    "tssl",
    "tbaf",
    "td",
    // Dispatcher
    "transpile",
    // Batch-state helper (TSSL multi-file passes)
    "createBatchState",
    // Error type
    "UnknownTranspileExtensionError",
] as const;

describe("@bgforge/transpile public API", () => {
    for (const name of REQUIRED_VALUE_EXPORTS) {
        it(`exports ${name}`, () => {
            expect((transpile as Record<string, unknown>)[name]).toBeDefined();
        });
    }
});
