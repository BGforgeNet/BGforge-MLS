/**
 * Shared MAP fixture inventory and loaders for the map-parser suites.
 *
 * Split out when `map-parser.test.ts` was divided into three files (`map-parser`, `map-json-snapshot`,
 * `map-real-corpus`): the whole MAP surface used to sit in one file, and because vitest parallelises across
 * FILES, that one file was the binary suite's wall-clock floor at ~24s against a ~28s suite. The three read
 * the same fixtures, so the inventory lives here rather than being restated - same pattern as
 * `server/test/integration/dialog-writeback-corpus.ts`.
 */

import * as fs from "fs";
import * as path from "path";
import { REPO_ROOT } from "./repo-root";

const MAPS_DIR = path.join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/data/maps");

/** Real Fallout 2 maps from the external corpus; absent unless `pnpm test:external` has run. */
export const REAL_MAPS = [
    path.join(MAPS_DIR, "artemple.map"),
    path.join(MAPS_DIR, "arvillag.map"),
    path.join(MAPS_DIR, "denbus1.map"),
    path.join(MAPS_DIR, "navarro.map"),
    path.join(MAPS_DIR, "vault13.map"),
    path.join(MAPS_DIR, "newr1.map"),
    path.join(MAPS_DIR, "sftanker.map"),
] as const;

export const hasExternalMaps = fs.existsSync(MAPS_DIR);

/**
 * `external/fallout-exclude.txt` keeps this one out of the corpus sweep - it is the map strict parsing
 * rejects (see SNAPSHOT_GRACEFUL_MAPS). The round-trip selection honours the same exclusion so the two
 * agree on what "the corpus" means.
 */
const SWEEP_EXCLUDED_MAPS = new Set(["sfsheng.map"]);

/**
 * Floor on the corpus population, a margin below the 173 swept today. It is what stops a corpus mid-reset
 * from silently shrinking the round-trip to a handful of maps that all pass.
 */
export const MAP_CORPUS_FLOOR = 150;

/** Every sweepable map in the corpus, sorted - the population `roundTripMaps` samples from. */
export function listCorpusMaps(): string[] {
    return fs
        .readdirSync(MAPS_DIR)
        .filter((name) => name.toLowerCase().endsWith(".map") && !SWEEP_EXCLUDED_MAPS.has(name.toLowerCase()))
        .sort();
}

/**
 * `count` maps spread evenly across the corpus, deterministic for a given corpus and inclusive of both
 * ends. A stride rather than the first N because the directory sorts by name and map size and structure
 * cluster by area prefix, so a head slice would sample one part of the game.
 */
export function roundTripMaps(count: number): string[] {
    const all = listCorpusMaps();
    if (all.length <= count) return all.map((name) => path.join(MAPS_DIR, name));
    const step = (all.length - 1) / (count - 1);
    return Array.from({ length: count }, (_, i) => path.join(MAPS_DIR, all[Math.round(i * step)]!));
}

/** Committed fixtures, resolved out of `client/testFixture/maps` rather than the external corpus. */
const LOCAL_FIXTURE_MAPS = new Set([
    "artemple.map",
    "arcaves.map",
    "bhrnddst.map",
    "denbus1.map",
    "newr2.map",
    "sfsheng.map",
]);

/**
 * The JSON-snapshot round-trip matrix, chosen on the structural axes the parse modes actually branch on
 * rather than on every committed fixture. `artemple` has an empty global-variable section (0 globals) and
 * `arcaves` the most populated one (21), which is the section shape a snapshot round-trip can get wrong;
 * `bhrnddst`, `denbus1` and `newr2` are the same shape at other scales (2 / 10 / 1 globals). Every fixture
 * in the directory still round-trips `parse -> serialize` byte-identically in `canonical-roundtrip.test.ts`,
 * which sweeps the whole directory - what is scoped here is the JSON-snapshot x parse-mode cross-product.
 */
export const SNAPSHOT_STRICT_MAPS = ["artemple.map", "arcaves.map"] as const;

/** `sfsheng.map` is the only fixture strict parsing rejects, so the ambiguous-boundary path is graceful-only. */
export const SNAPSHOT_GRACEFUL_MAPS = [...SNAPSHOT_STRICT_MAPS, "sfsheng.map"] as const;

export function resolveMapPath(fileName: string): string {
    if (LOCAL_FIXTURE_MAPS.has(fileName)) {
        return path.join(REPO_ROOT, "client/testFixture/maps", fileName);
    }
    return path.join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/data/maps", fileName);
}

export function loadMap(mapPath: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(mapPath));
}

export function findFieldByName(
    fields: unknown[],
    name: string,
): { value: unknown; type?: unknown; rawValue?: unknown } {
    const found = fields.find((field) => {
        if (!field || typeof field !== "object") return false;
        return "name" in field && field.name === name;
    });

    if (!found || typeof found !== "object" || !("value" in found)) {
        throw new Error(`Missing field ${name}`);
    }

    return found;
}

export function findGroupByName(fields: unknown[], name: string): { name: string; fields: unknown[] } {
    const found = fields.find((field) => {
        if (!field || typeof field !== "object") return false;
        return "name" in field && field.name === name && "fields" in field;
    });

    if (!found || typeof found !== "object" || !("fields" in found)) {
        throw new Error(`Missing group ${name}`);
    }

    return found as { name: string; fields: unknown[] };
}
