#!/usr/bin/env tsx
/**
 * Regenerate a vendored animation table in animation/src/animation-tables/ from the declarations an
 * Enhanced Edition install ships, and check the result against a classic archive of the same family.
 *
 * A classic install declares no animation INIs, so the id -> BAM prefix mapping has to be written down for the
 * gallery to draw one. Deriving it from an EE install's own INIs keeps the rows ours and re-derivable, rather
 * than transcribed; the classic archive is what proves each row names files that install actually has.
 *
 * Usage:
 *   pnpm exec tsx animation/test/tools/generate-animation-tables.ts --table bg2 --ee <dir> [--classic <dir>]
 *   pnpm exec tsx animation/test/tools/generate-animation-tables.ts --table bg2 --ee <dir> --check
 *
 * `--check` exits 1 on drift. Rows the classic archive contradicts are reported, never silently emitted: a
 * classic delta belongs in the target file's hand-authored block, with the evidence that put it there.
 *
 * Lives under `animation/test/` rather than `scripts/` because it reads an archive through `@bgforge/binary`,
 * which the client's config already resolves to source; the scripts config is NodeNext and cannot compile
 * that package's sources.
 */

import * as fs from "fs";
import * as path from "path";
// By path rather than by package name: this runs under tsx from the repo root, where the package specifier
// resolves to the workspace package's built entry point and so would need a build first.
import { openGame } from "../../../binary/src/index";
import { declaredFamily, parseAnimationIni } from "../../src/animation-ini";
import { characterDrawsBody } from "../../src/animation-schemes/character";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const TABLE_DIR = path.join(REPO_ROOT, "animation/src/animation-tables");
const BEGIN_MARKER = "    // BEGIN GENERATED ROWS";
const END_MARKER = "    // END GENERATED ROWS";

/** The id an animation's INI is named after: its id in hex, four digits, uppercase. */
const HEX_RESREF = /^[0-9A-Fa-f]{4}$/;

interface Row {
    id: number;
    prefixes: string[];
    section: string;
    paperdoll?: string;
    overlays?: string[];
}

/**
 * One prefix per armour level, from the INI's base and specific armour letters: the letter replaces the
 * prefix's fourth character, the base one carrying the lower levels and the specific one the top.
 *
 * Deliberately the same derivation `animation-index.ts` applies to a live INI - the table is the same fact
 * written down, so a second reading of it here would be a second definition to drift from.
 */
function prefixesOf(ini: ReturnType<typeof parseAnimationIni>): string[] {
    if (ini.resref === undefined) return [];
    const levels = ini.armorMax ?? 1;
    const prefixes: string[] = [];
    for (let level = 1; level <= levels; level++) {
        const letter = level === levels ? ini.armorSpecific : ini.armorBase;
        prefixes.push(letter === undefined ? ini.resref : ini.resref.slice(0, 3) + letter);
    }
    // One entry per level even where they are all the same: the array's LENGTH is the level count, which the
    // armour picker offers and the archive check iterates. Collapsing equal entries loses it, and a set whose
    // files start at level 2 then reads as having none.
    return prefixes;
}

function readRows(gameDir: string): Row[] {
    const game = openGame(gameDir);
    if (game === undefined) throw new Error(`no Infinity Engine install at ${gameDir}`);
    const rows: Row[] = [];
    for (const ref of game.list()) {
        if (ref.ext?.toLowerCase() !== "ini" || !HEX_RESREF.test(ref.resref)) continue;
        const ini = parseAnimationIni(game.read(ref.resref, "ini"));
        const prefixes = prefixesOf(ini);
        // The family, not the bare header: the header alone puts the spell-layered animations in the plain
        // layered family, which draws none of their overlay files.
        const section = declaredFamily(ini);
        if (section === undefined || prefixes.length === 0) continue;
        rows.push({
            id: Number.parseInt(ref.resref, 16),
            prefixes,
            section,
            ...(ini.resrefPaperdoll === undefined ? {} : { paperdoll: ini.resrefPaperdoll }),
            ...(ini.weaponOverlays.length === 0 ? {} : { overlays: [...ini.weaponOverlays] }),
        });
    }
    return rows.sort((a, b) => a.id - b.id);
}

/**
 * Which rows the classic archive contradicts: a character row naming files it does not have.
 *
 * Asked through `characterActions`, the same resolver the panel uses, rather than by testing one sequence
 * name. A hand-rolled check here was a second derivation of which files a set draws, and it disagreed - it
 * looked for `G1`, which the thief-body sets do not ship, and reported twenty rows as missing that resolve.
 */
function unsupported(rows: readonly Row[], classicDir: string): Row[] {
    const game = openGame(classicDir);
    if (game === undefined) throw new Error(`no Infinity Engine install at ${classicDir}`);
    const exists = (resref: string): boolean => game.canRead(resref, "bam");
    return rows.filter((row) => {
        if (row.section !== "character") return false;
        const set = {
            id: row.id,
            code: "",
            name: "",
            prefixByArmour: new Map(row.prefixes.map((prefix, at) => [at + 1, prefix])),
            paperdollPrefix: row.paperdoll,
            scheme: { kind: "character" as const },
        };
        return !characterDrawsBody(set, exists);
    });
}

const hex = (id: number): string => `0x${id.toString(16).padStart(4, "0")}`;

function render(rows: readonly Row[]): string {
    const lines = rows.map((row) => {
        const prefixes = row.prefixes.map((prefix) => `"${prefix}"`).join(", ");
        const paperdoll = row.paperdoll === undefined ? "" : `, paperdoll: "${row.paperdoll}"`;
        const overlays =
            row.overlays === undefined ? "" : `, overlays: [${row.overlays.map((o) => `"${o}"`).join(", ")}]`;
        return `    [${hex(row.id)}, { prefixes: [${prefixes}], section: "${row.section}"${paperdoll}${overlays} }],`;
    });
    return [BEGIN_MARKER, ...lines, END_MARKER].join("\n");
}

function splice(current: string, generated: string): string {
    const begin = current.indexOf(BEGIN_MARKER);
    const end = current.indexOf(END_MARKER);
    if (begin === -1 || end === -1) throw new Error(`target file has no ${BEGIN_MARKER.trim()} block`);
    return current.slice(0, begin) + generated + current.slice(end + END_MARKER.length);
}

function arg(name: string): string | undefined {
    const at = process.argv.indexOf(`--${name}`);
    return at === -1 ? undefined : process.argv[at + 1];
}

const table = arg("table");
const eeDir = arg("ee");
if (table === undefined || eeDir === undefined) {
    // Naming the missing one, not the rule: the caller can see which half they gave.
    throw new Error(`${table === undefined ? "--table" : "--ee"} is required`);
}
const target = path.join(TABLE_DIR, `${table}.ts`);
if (!fs.existsSync(target)) throw new Error(`no table at ${path.relative(REPO_ROOT, target)}`);

const rows = readRows(eeDir);
const classicDir = arg("classic");
if (classicDir !== undefined) {
    const contradicted = unsupported(rows, classicDir);
    for (const row of contradicted) {
        process.stderr.write(`classic archive has no ${row.prefixes.join("/")}: ${hex(row.id)}\n`);
    }
    process.stderr.write(`${rows.length} rows, ${contradicted.length} contradicted by the classic archive\n`);
}

const updated = splice(fs.readFileSync(target, "utf8"), render(rows));
if (process.argv.includes("--check")) {
    if (updated === fs.readFileSync(target, "utf8")) {
        process.stdout.write(`${table}: up to date (${rows.length} rows)\n`);
    } else {
        process.stderr.write(`${table}: out of date - rerun without --check\n`);
        process.exit(1);
    }
} else {
    fs.writeFileSync(target, updated);
    process.stdout.write(`${table}: wrote ${rows.length} rows\n`);
}
