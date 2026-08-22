/**
 * The bound every synchronous child-process spawn carries.
 *
 * `execFileSync`/`execSync`/`spawnSync` hold the calling thread until the child exits, so a child that stops
 * making progress hangs the caller with nothing able to interrupt it - a test runner's own per-test timeout is
 * enforced from an event loop the blocked thread never yields to, and the runner cannot even print which file it
 * was in. One wedged child then costs the whole job's time limit rather than one failing test.
 *
 * The value is deliberately far above any real run: it is a hang detector, not a performance budget, and a
 * timeout that fires on a merely slow machine would be a flake generator. Sites needing a tighter bound pass
 * their own; `scripts/utils/test/spawn-timeouts.test.ts` enforces that every site passes one.
 */
export const SPAWN_TIMEOUT_MS = 120_000;
