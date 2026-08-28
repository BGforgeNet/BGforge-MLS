/**
 * A dependency module with top-level work and an export nobody calls.
 *
 * The side effect is a call into an EXTERNAL module, which no tree-shaker can prove inert - a local
 * mutation would be dropped on its own analysis and would not distinguish the two configurations.
 * So the marker constant survives into the bundle unless something marked this module
 * `sideEffects: false` during resolution, letting the module be dropped whole.
 */

import { tlk } from "./engine";

tlk(0x9999);

export function neverCalled(): number {
    return 42;
}
