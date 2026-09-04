/**
 * IE creature recolouring: resolve a creature's seven colour indices into an animation's palette.
 *
 * A creature BAM ships placeholder gradients in its palette rather than final colours - the engine
 * overwrites them per creature before drawing, which is how one animation serves many characters. A
 * viewer that skips this step shows the placeholders (green hair, blue armour) rather than a bug.
 */
import type { Rgba } from "../model/animation.ts";
import { readBmpRgba } from "../bmp/parse.ts";

/** Colours per range, and the number of ranges: the palette carries 7 x 12 entries from `RANGES_START`. */
const RANGE_COLORS = 12;
const RANGES_START = 0x04;

/**
 * The seven recolourable ranges, in palette order. The names are the engine's own and match the CRE
 * header's seven consecutive colour bytes, so the order here is also the order they are stored in.
 */
export const CREATURE_RANGES = ["metal", "minor", "major", "skin", "leather", "armor", "hair"] as const;

export type CreatureRange = (typeof CREATURE_RANGES)[number];

/** One creature's colour selection: a gradient index per range, as the CRE header stores them. */
export type CreatureColors = Record<CreatureRange, number>;

/**
 * The install's gradient table, as one gradient per image row. It ships as a bitmap whose width is
 * exactly a range's colour count, so a row IS a range's replacement colours and the row number is the
 * index a creature stores. A wider image is read at its first `RANGE_COLORS` columns; a narrower one
 * cannot supply a range at all and is refused rather than padded into plausible-looking output.
 */
export function parseGradientTable(bmp: Uint8Array): Rgba[][] {
    const image = readBmpRgba(bmp);
    if (image.width < RANGE_COLORS) {
        throw new Error(
            `parseGradientTable: gradient table is ${image.width} columns wide, a range needs ${RANGE_COLORS}`,
        );
    }
    const table: Rgba[][] = [];
    for (let y = 0; y < image.height; y++) {
        const row: Rgba[] = [];
        for (let x = 0; x < RANGE_COLORS; x++) {
            const at = (y * image.width + x) * 4;
            row.push({
                r: image.rgba[at] ?? 0,
                g: image.rgba[at + 1] ?? 0,
                b: image.rgba[at + 2] ?? 0,
                a: image.rgba[at + 3] ?? 255,
            });
        }
        table.push(row);
    }
    return table;
}

/** Entries per mirrored block, and how far into its source range each one starts. */
const MIRROR_COLORS = 8;
/** The copies skip the range's brightest entry - they begin one slot in. */
const MIRROR_SOURCE_OFFSET = 1;

function mirrorRun(start: number, endExclusive: number, from: CreatureRange): { at: number; from: CreatureRange }[] {
    const blocks: { at: number; from: CreatureRange }[] = [];
    for (let at = start; at < endExclusive; at += MIRROR_COLORS) blocks.push({ at, from });
    return blocks;
}

/**
 * The upper palette repeats the ranges in a fixed pattern the engine writes after resolving them, so a
 * sprite pixel indexing there recolours too. 0xa8-0xaf is covered by no block and stays as the file had it.
 */
const MIRRORED_BLOCKS: { at: number; from: CreatureRange }[] = [
    { at: 0x58, from: "minor" },
    { at: 0x60, from: "major" },
    { at: 0x68, from: "minor" },
    { at: 0x70, from: "metal" },
    { at: 0x78, from: "leather" },
    { at: 0x80, from: "leather" },
    { at: 0x88, from: "minor" },
    ...mirrorRun(0x90, 0xa8, "leather"),
    { at: 0xb0, from: "skin" },
    ...mirrorRun(0xb8, 0x100, "leather"),
];

/** Palette slot 1 is the drop shadow: always black, whatever the file carries. */
const SHADOW_INDEX = 1;

function rangeStart(name: CreatureRange): number {
    return RANGES_START + CREATURE_RANGES.indexOf(name) * RANGE_COLORS;
}

/**
 * A creature palette with the seven ranges resolved. `table` is the install's gradient table, indexed
 * by the creature's own colour bytes; an index past its end falls back to the first row, as the engine
 * does, rather than leaving a placeholder range half-resolved.
 */
export function applyCreatureColors(
    palette: readonly Rgba[],
    table: readonly (readonly Rgba[])[],
    colors: CreatureColors,
): Rgba[] {
    const out = palette.map((c) => ({ ...c }));
    for (const [range, name] of CREATURE_RANGES.entries()) {
        const gradient = table[colors[name]] ?? table[0];
        // No table at all (the install shipped none, or it would not read): the placeholders stand.
        // Inventing a recolour from nothing would look like a real creature and be nobody's.
        if (!gradient) continue;
        const start = RANGES_START + range * RANGE_COLORS;
        for (const [i, color] of gradient.slice(0, RANGE_COLORS).entries()) out[start + i] = { ...color };
    }
    for (const block of MIRRORED_BLOCKS) {
        const from = rangeStart(block.from) + MIRROR_SOURCE_OFFSET;
        for (const [i, color] of out.slice(from, from + MIRROR_COLORS).entries()) {
            out[block.at + i] = { ...color };
        }
    }
    out[SHADOW_INDEX] = { r: 0, g: 0, b: 0, a: 255 };
    return out;
}
