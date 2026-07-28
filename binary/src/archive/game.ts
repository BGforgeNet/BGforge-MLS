/**
 * A game's live resource namespace: parse `chitin.key` once, build one in-memory resolution tree over the
 * override folders and the BIFs, and read/write/remove against that tree - mutations update it in place, never
 * re-scanning the filesystem. BIFs are opened lazily and read a resource at a time (positioned), so large BIFs
 * are never bulk-loaded. Call `close()` to release open BIF fds.
 *
 * Resolution matches WeiDU (the toolchain this emulates): override loose files win over BIFs, and among BIF
 * duplicates the last KEY entry wins (see `./key`). WeiDU's default override search is `<game>/override` alone,
 * so that is the default here. `engineOverrideFolders()` supplies the fuller engine stack for callers who want
 * it.
 */

import * as fs from "fs";
import * as path from "path";
import { openBif, type BifArchive } from "./bif";
import { atomicWriteFileSync, fileSource } from "./byte-source";
import { detectGameIdentity, refineGameFlavour, type GameIdentity } from "./game-type";
import { parseKey, type KeyIndex } from "./key";
import { RESOURCE_TYPE_TIS, resourceTypeCode, resourceTypeExt } from "./resource-type";
import { parseIds } from "./ids";
import { parse2daRowNames } from "./two-da";
import { openTlk, type Tlk } from "./tlk";

/** IDS and 2DA resource types (IESDP general.htm resource-type table). */
const IDS_RESTYPE = 0x03f0;
const TWO_DA_RESTYPE = 0x03f4;

export interface GameResourceRef {
    readonly resref: string;
    readonly type: number;
    readonly ext: string | undefined;
    /** Where the winning copy lives: a BIF name, or `<folder>/<file>` for an override loose file. */
    readonly bif: string;
}

export interface Game {
    readonly key: KeyIndex;
    /** Detected game type/edition (WeiDU-style), for display and for the TLK-encoding default. */
    readonly identity: GameIdentity;
    /** Every resolvable resource, winner per (resref, type). */
    list(): GameResourceRef[];
    /**
     * Extract one resource's winning bytes. `type` may be a resType number or an extension ("itm"/".itm");
     * omit it only for a resource the KEY knows (its type is looked up there). An override loose file wins
     * over the biffed copy.
     */
    read(resref: string, type?: number | string): Uint8Array;
    /**
     * Whether the resource can actually be read: it has a loose override, or its winning BIF is installed. False
     * when the only source is a BIF that no data root holds (some KEYs reference absent developer archives like
     * `PROGTEST.BIF`). Cheap and memoized - use it to skip or flag unopenable resources instead of failing.
     */
    canRead(resref: string, type: number | string): boolean;
    /**
     * Install a resource as a loose file (atomically) and update the tree in place, so a later `read` returns
     * it without any re-scan. Writes to the `override` folder by default; `options.folder` must be one of the
     * configured override folders. `type` is a resType number or extension (needed to name the file).
     */
    write(resref: string, type: number | string, bytes: Uint8Array, options?: { folder?: string }): void;
    /**
     * Delete a resource's loose file from an override folder and update the tree in place: the winner falls
     * back to whatever it shadowed (a lower override folder or the BIF copy). Returns false if no such loose
     * file was tracked. BIF content cannot be removed.
     */
    remove(resref: string, type: number | string, options?: { folder?: string }): boolean;
    /**
     * Write an auxiliary loose file (e.g. a JSON snapshot sidecar) into the `override` folder under the given
     * name. Unlike `write`, this is NOT a game resource: it is not indexed, and the open-time scan ignores it
     * because its extension has no resType, so it never appears in `list()`. Returns the written path.
     */
    writeAuxFile(fileName: string, bytes: Uint8Array): string;
    /** Read an auxiliary loose file from the `override` folder (see `writeAuxFile`), or undefined if absent. */
    readAuxFile(fileName: string): Uint8Array | undefined;
    /**
     * The game's TLK string table, opened lazily and cached; `undefined` if the game lacks it. `variant`
     * selects the male/default `dialog.tlk` (default) or the female `dialogF.tlk`. Records reference strings by
     * strref - resolve them via `tlk()?.get(strref)`.
     */
    tlk(variant?: "male" | "female"): Tlk | undefined;
    /**
     * An IDS lookup table from THIS install, by resref (e.g. `ids("SNDSLOT")`). Undefined when the game has no
     * such table. Read from the game rather than vendored because the mapping is per-install: BG1's
     * SOUNDOFF.IDS and BG2's SNDSLOT.IDS disagree on most sound slots, and mods extend these tables.
     */
    ids(resref: string): ReadonlyMap<number, string> | undefined;
    /**
     * A 2DA table from THIS install as row index -> row NAME (e.g. `twoDa("MSCHOOL")`). Undefined when the game
     * has no such table - `itemtype.2da` ships only with the Enhanced Editions, for instance. Read from the game
     * for the same reason as `ids`: the tables are per-install and mod-extensible.
     */
    twoDa(resref: string): ReadonlyMap<number, string> | undefined;
    close(): void;
}

export interface OpenGameOptions {
    /**
     * Which override-folder stack to search:
     * - `"weidu"` (default) - WeiDU-like: the literal `<game>/override` folder only. Use this when resolution
     *   must match what WeiDU (and the installer emulating it) would see.
     * - `"engine"` - the fuller engine stack (IESDP `appendices/override.htm`): movies, characters,
     *   portraits/portrait, sounds, scripts, override, plus `lang/<lang>/{movies,sounds}` when `lang` is set.
     *   Use this for a viewer that should resolve exactly what the running game would.
     *
     * `overrideFolders` overrides this entirely.
     */
    mode?: "weidu" | "engine";
    /**
     * EE language folder (e.g. "en_US"). Optional: an explicit value is always honored; otherwise, for EE games
     * only, it is auto-resolved WeiDU-style from `weidu.conf` or the sorted-first `lang/<x>` that has a
     * `dialog.tlk`, so `dialog.tlk` and the `lang/<lang>/{movies,sounds}` override folders resolve without the
     * caller knowing the language. Classic games have no auto-resolution (their `dialog.tlk` sits at the root).
     */
    lang?: string;
    /**
     * Explicit override-folder stack (relative to the game dir), searched highest priority first. Takes
     * precedence over `mode` - the escape hatch for a custom stack (e.g. adding the EE `home:` user-profile
     * folders, which need OS-specific profile resolution).
     */
    overrideFolders?: readonly string[];
    /**
     * Text encoding for the game's TLK strings. EE installs are auto-detected the way WeiDU does (marker
     * resources in the KEY) and read as UTF-8; classic installs default to windows-1252. Set this to the game
     * language's actual Windows codepage for non-Western classic games - "windows ANSI" is not always cp1252
     * (e.g. `"windows-1251"` Russian, `"windows-1250"` Polish/Czech). Any label the platform's `TextDecoder`
     * accepts; overrides the auto-detect.
     */
    encoding?: string;
}

/** WeiDU's default override search: `<game>/override` only. */
const WEIDU_OVERRIDE_FOLDERS: readonly string[] = ["override"];

/**
 * The engine's fuller install-side override stack, highest priority first (IESDP `appendices/override.htm`) -
 * broader than WeiDU's default. Classic games only have characters/portrait/sounds/scripts/override; the
 * EE-only folders simply won't exist and are skipped. Both "portraits" (EE) and "portrait" (classic) are
 * searched. The EE `home:` user-profile folders need OS profile resolution and are not included.
 */
export function engineOverrideFolders(lang?: string): string[] {
    return [
        ...(lang ? [`lang/${lang}/movies`] : []),
        "movies",
        "characters",
        "portraits",
        "portrait",
        ...(lang ? [`lang/${lang}/sounds`] : []),
        "sounds",
        "scripts",
        "override",
    ];
}

// A resolved source for one (resref, type): a loose override file or a BIF locator. `rank` orders precedence -
// lower wins (override folders take their index in the stack; the BIF sits below all of them).
type Source =
    | { kind: "file"; folder: string; path: string; rank: number }
    | {
          kind: "bif";
          bifIndex: number;
          fileIndex: number;
          tilesetIndex: number;
          type: number;
          rank: number;
      };

interface TreeEntry {
    resref: string; // uppercased
    type: number;
    sources: Source[]; // sorted by rank ascending; sources[0] is the winner
}

/** Resolve `name` in `dir` allowing a case difference (IE ships lowercase names; case-sensitive hosts differ). */
function resolveCaseInsensitive(dir: string, name: string): string | undefined {
    const exact = path.join(dir, name);
    if (fs.existsSync(exact)) return exact;
    let entries: string[];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return undefined;
    }
    const lower = name.toLowerCase();
    const hit = entries.find((e) => e.toLowerCase() === lower);
    return hit ? path.join(dir, hit) : undefined;
}

/** Read `weidu.conf`'s `lang_dir` (the user's selected EE language folder), if present. */
function readWeiduConfLang(gameDir: string): string | undefined {
    const conf = resolveCaseInsensitive(gameDir, "weidu.conf");
    if (!conf) return undefined;
    try {
        const match = /^\s*lang_dir\s*=\s*(.+?)\s*$/im.exec(fs.readFileSync(conf, "utf8"));
        return match?.[1];
    } catch {
        return undefined;
    }
}

/**
 * Resolve the EE language folder the way WeiDU does: an explicit `lang` wins; otherwise for EE games take
 * `weidu.conf`'s `lang_dir`, falling back to the sorted-first `lang/<x>` subdir that actually contains a
 * `dialog.tlk`. Classic games keep `dialog.tlk` at the root and have
 * no language folder (returns undefined). The returned name is matched case-insensitively downstream, so a
 * `weidu.conf` `en_us` still resolves the real `lang/en_US`.
 */
function resolveLangDir(gameDir: string, edition: string, explicitLang?: string): string | undefined {
    if (explicitLang) return explicitLang;
    if (edition !== "ee") return undefined;
    const langRoot = resolveCaseInsensitive(gameDir, "lang");
    if (!langRoot) return undefined;
    const hasDialog = (sub: string): boolean => {
        const subDir = resolveCaseInsensitive(langRoot, sub);
        return subDir !== undefined && resolveCaseInsensitive(subDir, "dialog.tlk") !== undefined;
    };
    const confLang = readWeiduConfLang(gameDir);
    if (confLang && hasDialog(confLang)) return confLang;
    let entries: string[];
    try {
        entries = fs.readdirSync(langRoot);
    } catch {
        return undefined;
    }
    return entries.filter((e) => hasDialog(e)).sort()[0];
}

/** Resolve a game-relative path (`data/foo.bif`, `lang/en_US/override`) segment by segment, case-insensitively. */
function resolveGamePath(gameDir: string, relative: string): string | undefined {
    let cur = gameDir;
    for (const seg of relative.split("/").filter((s) => s !== "")) {
        const next = resolveCaseInsensitive(cur, seg);
        if (!next) return undefined;
        cur = next;
    }
    return cur === gameDir ? undefined : cur;
}

/**
 * BIF search roots relative to the game dir, matching how WeiDU / the engine find a biffed archive across the
 * install's data locations (a KEY biff name like `data/cdcreani.bif` is not always under `<game>/`). We combine
 * `baldur.ini`'s `[Alias]` CD/HD0 mappings - reduced to paths RELATIVE to HD0, since their absolute Windows
 * values don't transfer - with the standard defaults (`data`, `cache`, `CD1`..`CD6`). Order matters: the game
 * root first (HD0), so a BIF present both loose and under a CD dir resolves to the loose copy.
 */
function bifSearchRelRoots(gameDir: string): string[] {
    const roots = new Set<string>([""]); // "" = the game dir itself (HD0)
    const iniPath = resolveCaseInsensitive(gameDir, "baldur.ini");
    if (iniPath) {
        try {
            const text = fs.readFileSync(iniPath, "latin1");
            const alias: Record<string, string> = {};
            let inAlias = false;
            for (const line of text.split(/\r?\n/)) {
                const section = /^\s*\[(.+?)\]\s*$/.exec(line);
                if (section) {
                    inAlias = section[1]!.toLowerCase() === "alias";
                } else if (inAlias) {
                    const kv = /^\s*([A-Za-z0-9]+)\s*:?=\s*(.+?)\s*$/.exec(line);
                    if (kv) alias[kv[1]!.toUpperCase()] = kv[2]!;
                }
            }
            const norm = (p: string): string => p.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
            const hd0 = alias["HD0"] ? norm(alias["HD0"]) : undefined;
            for (const [name, value] of Object.entries(alias)) {
                if (name === "HD0") continue;
                const cd = norm(value);
                if (hd0 && cd.startsWith(`${hd0}/`)) roots.add(cd.slice(hd0.length + 1));
                else if (hd0 && cd === hd0) roots.add("");
            }
        } catch {
            // Fall through to the defaults below.
        }
    }
    for (const rel of ["data", "cache", "CD1", "CD2", "CD3", "CD4", "CD5", "CD6"]) roots.add(rel);
    return [...roots];
}

export function openGame(gameDir: string, options: OpenGameOptions = {}): Game {
    const keyPath = resolveCaseInsensitive(gameDir, "chitin.key");
    if (!keyPath) throw new Error(`chitin.key not found in ${gameDir}`);
    const key = parseKey(fs.readFileSync(keyPath));
    const openBifs = new Map<number, BifArchive>();
    const bifRelRoots = bifSearchRelRoots(gameDir);

    // Game identity via WeiDU's KEY-marker autodetect (see ./game-type). TLK encoding follows the edition:
    // EE -> UTF-8; classic -> the language's Windows codepage (windows-1252 default, overridable, since
    // "windows ANSI" is not always cp1252). null in the tlk cache = the file is absent.
    // Coarse identity (KEY markers) drives encoding/lang; the flavour is refined against the live game below.
    const baseIdentity = detectGameIdentity(key);
    const tlkEncoding = options.encoding ?? (baseIdentity.edition === "ee" ? "utf-8" : "windows-1252");
    const tlkCache = new Map<"male" | "female", Tlk | null>();
    const idsCache = new Map<string, ReadonlyMap<number, string> | null>();
    const twoDaCache = new Map<string, ReadonlyMap<number, string> | null>();

    // WeiDU-style language resolution: EE games keep dialog.tlk under lang/<lang>/, so without an explicit lang
    // the folder is taken from weidu.conf (or the sorted-first lang subdir that has a dialog.tlk). Classic games
    // keep it at the root -> undefined. Feeds both the TLK lookup and the EE-only lang/<lang>/{movies,sounds}.
    const resolvedLang = resolveLangDir(gameDir, baseIdentity.edition, options.lang);

    const folders =
        options.overrideFolders ??
        (options.mode === "engine" ? engineOverrideFolders(resolvedLang) : WEIDU_OVERRIDE_FOLDERS);
    const folderRank = new Map<string, number>(folders.map((f, i) => [f, i]));
    const bifRank = folders.length; // below every override folder

    // Build the resolution tree once: BIF winners at the bottom (last KEY entry wins, per WeiDU), then override
    // folders layered above in priority order. From here on, reads and mutations touch this tree, never disk scans.
    const tree = new Map<string, TreeEntry>();
    const keyOf = (resref: string, type: number): string => `${resref.toUpperCase()}\0${type}`;

    for (const r of key.resources) {
        const k = keyOf(r.resref, r.type);
        const bifSource: Source = {
            kind: "bif",
            bifIndex: r.bifIndex,
            fileIndex: r.fileIndex,
            tilesetIndex: r.tilesetIndex,
            type: r.type,
            rank: bifRank,
        };
        const entry = tree.get(k);
        if (entry) {
            // Last KEY entry wins: replace the earlier BIF source for this key.
            entry.sources = entry.sources.filter((s) => s.kind !== "bif");
            entry.sources.push(bifSource);
        } else {
            tree.set(k, { resref: r.resref.toUpperCase(), type: r.type, sources: [bifSource] });
        }
    }

    folders.forEach((folder, rank) => {
        const dirPath = resolveGamePath(gameDir, folder);
        if (!dirPath) return;
        let names: string[];
        try {
            names = fs.readdirSync(dirPath);
        } catch {
            return;
        }
        for (const name of names) {
            const dot = name.lastIndexOf(".");
            if (dot <= 0) continue;
            const type = resourceTypeCode(name.slice(dot + 1));
            if (type === undefined) continue;
            const resref = name.slice(0, dot).toUpperCase();
            const k = keyOf(resref, type);
            const source: Source = { kind: "file", folder, path: path.join(dirPath, name), rank };
            const entry = tree.get(k);
            if (entry) entry.sources.push(source);
            else tree.set(k, { resref, type, sources: [source] });
        }
    });

    for (const entry of tree.values()) entry.sources.sort((a, b) => a.rank - b.rank);

    // Refine the flavour against the live game (override resources + loose files) for the conversions/expansions
    // that the KEY alone can't reveal: EET, SoD, BGT.
    const identity = refineGameFlavour(
        baseIdentity,
        (resref, type) => tree.has(keyOf(resref, type)),
        // Check the game root and, for EE installs, the language folder (movies/data are localized under lang/<x>).
        (relPath) =>
            resolveGamePath(gameDir, relPath) !== undefined ||
            (resolvedLang !== undefined && resolveGamePath(gameDir, `lang/${resolvedLang}/${relPath}`) !== undefined),
    );

    // Memoized on-disk path of a BIF (null = not installed anywhere in the search roots, e.g. a genuinely
    // absent developer archive like PROGTEST.BIF that some KEYs still reference).
    const bifPathCache = new Map<number, string | null>();
    function resolveBifPath(bifIndex: number): string | undefined {
        const cached = bifPathCache.get(bifIndex);
        if (cached !== undefined) return cached ?? undefined;
        const entry = key.bifs[bifIndex];
        // Search each data root (see bifSearchRelRoots) for the biff, first hit wins.
        const resolved = entry
            ? bifRelRoots
                  .map((rel) => resolveGamePath(gameDir, rel ? `${rel}/${entry.name}` : entry.name))
                  .find((p) => p !== undefined)
            : undefined;
        bifPathCache.set(bifIndex, resolved ?? null);
        return resolved;
    }

    function bifFor(bifIndex: number): BifArchive {
        const cached = openBifs.get(bifIndex);
        if (cached) return cached;
        const entry = key.bifs[bifIndex];
        if (!entry) throw new Error(`BIF index ${bifIndex} out of range`);
        const bifPath = resolveBifPath(bifIndex);
        if (!bifPath) throw new Error(`BIF file not found: ${entry.name}`);
        const archive = openBif(fileSource(bifPath));
        openBifs.set(bifIndex, archive);
        return archive;
    }

    function materialize(source: Source): Uint8Array {
        if (source.kind === "file") return fs.readFileSync(source.path);
        const archive = bifFor(source.bifIndex);
        return source.type === RESOURCE_TYPE_TIS
            ? archive.readTileset(source.tilesetIndex)
            : archive.readFile(source.fileIndex);
    }

    // resType from a number or extension string; throws on an unknown extension.
    function typeCodeOf(type: number | string): number {
        const code = typeof type === "string" ? resourceTypeCode(type) : type;
        if (code === undefined) throw new Error(`Unknown resource extension "${type}"`);
        return code;
    }

    function folderRankOf(folder: string): number {
        const rank = folderRank.get(folder);
        if (rank === undefined) {
            throw new Error(`Folder "${folder}" is not one of the override folders (${folders.join(", ")})`);
        }
        return rank;
    }

    return {
        key,
        identity,
        list() {
            const out: GameResourceRef[] = [];
            for (const entry of tree.values()) {
                const winner = entry.sources[0]!;
                out.push({
                    resref: entry.resref,
                    type: entry.type,
                    ext: resourceTypeExt(entry.type),
                    bif:
                        winner.kind === "file"
                            ? `${winner.folder}/${path.basename(winner.path)}`
                            : (key.bifs[winner.bifIndex]?.name ?? ""),
                });
            }
            return out;
        },
        read(resref, type) {
            let typeCode = type === undefined ? undefined : typeof type === "string" ? resourceTypeCode(type) : type;
            if (typeof type === "string" && typeCode === undefined) {
                throw new Error(`Unknown resource extension "${type}"`);
            }
            // No type given: recover it from the KEY (a loose-only resource needs an explicit type).
            if (typeCode === undefined) typeCode = key.lookup(resref)?.type;
            const entry = typeCode === undefined ? undefined : tree.get(keyOf(resref, typeCode));
            if (!entry || entry.sources.length === 0) {
                const suffix = typeCode !== undefined ? ` (type 0x${typeCode.toString(16)})` : "";
                throw new Error(`Resource not found: ${resref}${suffix}`);
            }
            return materialize(entry.sources[0]!);
        },
        canRead(resref, type) {
            const typeCode = typeof type === "string" ? resourceTypeCode(type) : type;
            const entry = typeCode === undefined ? undefined : tree.get(keyOf(resref, typeCode));
            const winner = entry?.sources[0];
            // A loose override wins outright; a biffed winner is readable only if its archive is installed.
            return winner !== undefined && (winner.kind === "file" || resolveBifPath(winner.bifIndex) !== undefined);
        },
        write(resref, type, bytes, writeOptions) {
            const typeCode = typeCodeOf(type);
            const ext = resourceTypeExt(typeCode);
            if (!ext) throw new Error(`No file extension known for resType 0x${typeCode.toString(16)}`);
            const folder = writeOptions?.folder ?? "override";
            const rank = folderRankOf(folder);
            const k = keyOf(resref, typeCode);
            const entry = tree.get(k) ?? { resref: resref.toUpperCase(), type: typeCode, sources: [] };

            // Reuse the existing loose file's path (preserving its on-disk case) if this folder already holds
            // one for this key; otherwise create a fresh lowercase filename in the (created-if-absent) folder.
            const existing = entry.sources.find((s) => s.kind === "file" && s.folder === folder);
            const targetPath =
                existing && existing.kind === "file"
                    ? existing.path
                    : path.join(ensureFolder(gameDir, folder), `${resref.toLowerCase()}.${ext}`);

            atomicWriteFileSync(targetPath, bytes);

            const newSource: Source = { kind: "file", folder, path: targetPath, rank };
            entry.sources = [
                ...entry.sources.filter((s) => !(s.kind === "file" && s.folder === folder)),
                newSource,
            ].sort((a, b) => a.rank - b.rank);
            tree.set(k, entry);
        },
        remove(resref, type, removeOptions) {
            const typeCode = typeCodeOf(type);
            const folder = removeOptions?.folder ?? "override";
            folderRankOf(folder); // validates the folder even when nothing is tracked
            const k = keyOf(resref, typeCode);
            const entry = tree.get(k);
            const source = entry?.sources.find(
                (s): s is Extract<Source, { kind: "file" }> => s.kind === "file" && s.folder === folder,
            );
            if (!entry || !source) return false;
            fs.rmSync(source.path, { force: true });
            entry.sources = entry.sources.filter((s) => s !== source);
            if (entry.sources.length === 0) tree.delete(k);
            return true;
        },
        writeAuxFile(fileName, bytes) {
            const target = path.join(ensureFolder(gameDir, "override"), fileName.toLowerCase());
            atomicWriteFileSync(target, bytes);
            return target;
        },
        readAuxFile(fileName) {
            const resolved = resolveGamePath(gameDir, `override/${fileName}`);
            return resolved ? fs.readFileSync(resolved) : undefined;
        },
        tlk(variant = "male") {
            let entry = tlkCache.get(variant);
            if (entry === undefined) {
                // EE keeps the TLKs under lang/<lang>/; classic games keep them at the game root.
                const base = variant === "female" ? "dialogF.tlk" : "dialog.tlk";
                const candidates = [...(resolvedLang ? [`lang/${resolvedLang}/${base}`] : []), base];
                let resolved: string | undefined;
                for (const candidate of candidates) {
                    resolved = resolveGamePath(gameDir, candidate);
                    if (resolved) break;
                }
                entry = resolved ? openTlk(fileSource(resolved), { encoding: tlkEncoding }) : null;
                tlkCache.set(variant, entry);
            }
            return entry ?? undefined;
        },
        ids(resref) {
            const cacheKey = resref.toLowerCase();
            let entry = idsCache.get(cacheKey);
            if (entry === undefined) {
                // An absent table is normal (not every game ships every IDS), so it caches as null rather than
                // re-reading on each lookup.
                entry = null;
                try {
                    entry = parseIds(this.read(resref, IDS_RESTYPE));
                } catch {
                    // Resource not found, or unreadable - reported as "no table" by the null above.
                }
                idsCache.set(cacheKey, entry);
            }
            return entry ?? undefined;
        },
        twoDa(resref) {
            const cacheKey = resref.toLowerCase();
            let entry = twoDaCache.get(cacheKey);
            if (entry === undefined) {
                // Absent is normal - itemtype.2da is Enhanced-Edition-only - so it caches as null rather than
                // re-reading on each lookup, exactly as `ids` above.
                entry = null;
                try {
                    entry = parse2daRowNames(this.read(resref, TWO_DA_RESTYPE));
                } catch {
                    // Resource not found, or unreadable - reported as "no table" by the null above.
                }
                twoDaCache.set(cacheKey, entry);
            }
            return entry ?? undefined;
        },
        close() {
            for (const archive of openBifs.values()) archive.close();
            openBifs.clear();
            for (const openTlkFile of tlkCache.values()) if (openTlkFile) openTlkFile.close();
            tlkCache.clear();
        },
    };
}

/** Resolve an override folder under `gameDir`, creating it (recursively) if absent; returns its absolute path. */
function ensureFolder(gameDir: string, folder: string): string {
    const existing = resolveGamePath(gameDir, folder);
    if (existing) return existing;
    const created = path.join(gameDir, folder);
    fs.mkdirSync(created, { recursive: true });
    return created;
}
