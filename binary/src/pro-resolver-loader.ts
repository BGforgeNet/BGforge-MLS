/**
 * Filesystem-backed pid -> subType resolver.
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
import { MAX_FILE_SIZES } from "./max-file-sizes";
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
 * `pid -> subType` lookup. Missing subdirs are silently empty; malformed
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
        } catch (error) {
            // Missing dir is the common case for partial mod trees - silently empty.
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            errors.push(`Failed to list ${dir}: ${(error as Error).message}`);
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

            const reading = cachedReading(filePath, section);
            if (typeof reading === "string") {
                errors.push(reading);
                continue;
            }
            map.set(pid, reading);
            subtypesResolved++;
        }
    }

    const durationMs = performance.now() - start;
    const resolver: PidResolver = (pid) => map.get(pid);
    return { resolver, stats: { filesScanned, subtypesResolved, errors, durationMs } };
}

/** A file's subType, or the message saying why it has none. */
type Reading = number | string;

/**
 * Each .pro's reading, keyed by path and valid while its size and modification time are unchanged. The CLI
 * loads the same tree once per map and the editor worker once per open; a stat per file costs a fraction of
 * the read and parse it replaces, and still notices a proto rewritten in place. Grows by one entry per file
 * of each tree ever loaded - a mod's few hundred protos.
 */
const readings = new Map<string, { size: number; mtimeMs: number; reading: Reading }>();

function cachedReading(filePath: string, section: SubdirSpec["section"]): Reading {
    let stat: fs.Stats;
    try {
        stat = fs.statSync(filePath);
    } catch (error) {
        readings.delete(filePath);
        return `Failed to parse ${filePath}: ${(error as Error).message}`;
    }
    const cached = readings.get(filePath);
    if (cached !== undefined && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.reading;
    const reading = readSubType(filePath, section);
    readings.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, reading });
    return reading;
}

function readSubType(filePath: string, section: SubdirSpec["section"]): Reading {
    try {
        // Same stat-before-allocate budget the CLI parse path applies (max-file-sizes.ts):
        // the parser's own 1 KB limit rejects oversized DATA, but only after the whole file
        // has already been read into memory - cap the read itself. fstat and read go through
        // ONE descriptor so the size check and the read see the same inode; a statSync ->
        // readFileSync pair on the path leaves a TOCTOU window (CodeQL js/file-system-race)
        // where a file swapped after the check could bypass the cap.
        const proCap = MAX_FILE_SIZES.pro;
        let data: Buffer;
        const fd = fs.openSync(filePath, "r");
        try {
            const size = fs.fstatSync(fd).size;
            if (proCap !== undefined && size > proCap) {
                return `Skipped ${filePath}: ${size} bytes exceeds the ${proCap}-byte PRO cap`;
            }
            data = fs.readFileSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        const parsed = proParser.parse(new Uint8Array(data));
        if (!parsed.document) return `Failed to parse ${filePath}: no canonical document`;
        const sections = (parsed.document as { sections?: Record<string, { subType?: number }> }).sections;
        const subType = sections?.[section]?.subType;
        if (typeof subType !== "number") return `Failed to read ${section}.subType from ${filePath}`;
        return subType;
    } catch (error) {
        return `Failed to parse ${filePath}: ${(error as Error).message}`;
    }
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
        // oxlint-disable-next-line unicorn/no-useless-undefined -- TS noImplicitReturns flags the implicit-undefined path; explicit return needed
        return undefined;
    };
}
