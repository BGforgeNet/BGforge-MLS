/**
 * Filesystem-backed pid → subType resolver.
 *
 * Scans `<protoBaseDir>/items/*.pro` and `<protoBaseDir>/scenery/*.pro` (top
 * level only, no recursion), reads each file's `subType` via the existing
 * `proParser`, and returns a resolver function plus walk statistics. Used to
 * extend MAP decoding to modded pids by pointing at a mod's own `proto/`
 * tree, on top of the bundled vanilla Fallout 2 lookup table.
 *
 * Filename convention is the Fallout 2 standard: 8-digit zero-padded decimal
 * objectId, e.g. `00000031.pro`. The full pid is `(pidType << 24) | objectId`,
 * with `pidType` 0 for items and 2 for scenery.
 */

import * as fs from "fs";
import * as path from "path";
import { performance } from "perf_hooks";
import { proParser } from "./pro";
import type { PidResolver } from "./pid-resolver";

interface SubdirSpec {
    readonly subdir: "items" | "scenery";
    readonly pidType: number;
    readonly section: "itemProperties" | "sceneryProperties";
}

const SUBDIRS: readonly SubdirSpec[] = [
    { subdir: "items", pidType: 0, section: "itemProperties" },
    { subdir: "scenery", pidType: 2, section: "sceneryProperties" },
];

const PRO_FILENAME = /^(\d{8})\.pro$/;

export interface ProResolverStats {
    /** Number of `.pro` files matched, attempted to parse, and counted (success or failure). */
    filesScanned: number;
    /** Subset of `filesScanned` whose subType was successfully extracted. */
    subtypesResolved: number;
    /** Per-file error messages (one entry per malformed/unparseable .pro). */
    errors: string[];
    /** Wall-clock duration of the scan + parse. */
    durationMs: number;
}

export interface ProResolverResult {
    resolver: PidResolver;
    stats: ProResolverStats;
}

/**
 * Walk the standard Fallout 2 proto layout under `protoBaseDir` and build a
 * `pid → subType` lookup. Missing subdirs are silently empty; malformed
 * `.pro` files are recorded in `stats.errors` and skipped. Files whose name
 * doesn't match the 8-digit pid convention are ignored without comment.
 */
export function loadProDirResolver(protoBaseDir: string): ProResolverResult {
    const start = performance.now();
    const map = new Map<number, number>();
    const errors: string[] = [];
    let filesScanned = 0;
    let subtypesResolved = 0;

    for (const { subdir, pidType, section } of SUBDIRS) {
        const dir = path.join(protoBaseDir, subdir);
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (err) {
            // Missing dir is the common case for partial mod trees — silently empty.
            if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
            errors.push(`Failed to list ${dir}: ${(err as Error).message}`);
            continue;
        }

        for (const entry of entries) {
            if (!entry.isFile()) continue;
            const match = PRO_FILENAME.exec(entry.name);
            if (!match) continue;
            filesScanned++;

            const filePath = path.join(dir, entry.name);
            const objectId = Number.parseInt(match[1]!, 10);
            const pid = (pidType << 24) | objectId;

            try {
                const data = fs.readFileSync(filePath);
                const parsed = proParser.parse(new Uint8Array(data));
                if (!parsed.document) {
                    errors.push(`Failed to parse ${filePath}: no canonical document`);
                    continue;
                }
                const sections = (parsed.document as { sections?: Record<string, { subType?: number }> }).sections;
                const subType = sections?.[section]?.subType;
                if (typeof subType !== "number") {
                    errors.push(`Failed to read ${section}.subType from ${filePath}`);
                    continue;
                }
                map.set(pid, subType);
                subtypesResolved++;
            } catch (err) {
                errors.push(`Failed to parse ${filePath}: ${(err as Error).message}`);
            }
        }
    }

    const durationMs = performance.now() - start;
    const resolver: PidResolver = (pid) => map.get(pid);
    return { resolver, stats: { filesScanned, subtypesResolved, errors, durationMs } };
}

/**
 * Compose multiple resolvers into one that returns the first non-`undefined`
 * result. Order matters: place override resolvers (e.g. mod-specific protos)
 * before the bundled defaults so overrides win.
 */
export function composePidResolvers(...resolvers: PidResolver[]): PidResolver {
    return (pid) => {
        for (const resolver of resolvers) {
            const value = resolver(pid);
            if (value !== undefined) return value;
        }
        return undefined;
    };
}
