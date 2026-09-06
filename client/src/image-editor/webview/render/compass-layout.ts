import type { Facing } from "@bgforge/image";
// The pure subpath, not the "@bgforge/image" barrel: the barrel's png/bamc codecs need Buffer/zlib and
// crash a browser webview bundle on load (see render/anchor.ts).
import { cycleDrawsArt } from "@bgforge/image/compose-parts";
import type { IeDirectionAnalysis, IeDirectionSlot } from "@bgforge/image/ie-direction";
import type { AnimationView, SequenceView } from "../messages";

/**
 * A tile's position on the compass rose as a unit-circle offset from the centre (y points DOWN, to
 * match screen coordinates). The caller scales dx/dy by a pixel radius. A rigid grid was tried first
 * and rejected: with FRM's 6 facings (no N/S) the middle column is empty, so the rose collapsed into
 * two straight columns. Placing each facing at its true compass angle keeps E/W out at the sides and
 * the diagonals pulled in, so 6 facings read as a hexagon and 8 as an octagon - an actual rose.
 */
export interface RosePosition {
    dx: number;
    dy: number;
}

// Compass angle per facing, degrees CCW from due-East. The 45-degree points carry the coarse schemes
// and FRM's hexagonal set; the half-steps between them complete the IE's 16-point wheel. "none" is
// non-directional.
const COMPASS_ANGLE_DEG: Record<Facing, number | undefined> = {
    E: 0,
    ENE: 22.5,
    NE: 45,
    NNE: 67.5,
    N: 90,
    NNW: 112.5,
    NW: 135,
    WNW: 157.5,
    W: 180,
    WSW: 202.5,
    SW: 225,
    SSW: 247.5,
    S: 270,
    SSE: 292.5,
    SE: 315,
    ESE: 337.5,
    none: undefined,
};

export function compassPosition(facing: Facing): RosePosition | undefined {
    const deg = COMPASS_ANGLE_DEG[facing];
    if (deg === undefined) return undefined;
    const rad = (deg * Math.PI) / 180;
    // Negate the sine: screen y grows downward, so a northern (positive-angle) facing sits ABOVE centre.
    return { dx: Math.cos(rad), dy: -Math.sin(rad) };
}

/**
 * Where the rose's tiles sit, in tile widths, fitted to the facings actually present.
 *
 * Two things vary with the scheme and neither can be a constant. The RADIUS has to grow as the facings
 * crowd: neighbours sit a chord of `2r*sin(gap/2)` apart, so the 45-degree schemes clear each other at
 * the historical 1.5 while the 22.5-degree wheel needs better than 2.5 or its tiles overlap. And the BOX
 * has to fit the tiles rather than the whole circle: a stored western arc covers half the compass, and a
 * square box around it would be half empty, pushing the drawn half off the stage's centre.
 */
export interface RoseGeometry {
    radiusTiles: number;
    widthTiles: number;
    heightTiles: number;
    /** Tile centre within the box, in tile widths, one per input tile in order. */
    centers: { x: number; y: number }[];
}

/** Historical radius, and the floor: the sparser schemes keep the spacing they have always had. */
const MIN_RADIUS_TILES = 1.5;

export function roseGeometry(tiles: readonly { pos: RosePosition }[]): RoseGeometry {
    const angles = tiles.map((t) => Math.atan2(t.pos.dy, t.pos.dx)).sort((a, b) => a - b);
    let smallestGap = 2 * Math.PI;
    for (let i = 1; i < angles.length; i++)
        smallestGap = Math.min(smallestGap, (angles[i] ?? 0) - (angles[i - 1] ?? 0));
    // One tile of chord at the tightest gap is the no-overlap condition, solved for the radius.
    const radiusTiles =
        angles.length < 2 ? MIN_RADIUS_TILES : Math.max(MIN_RADIUS_TILES, 1 / (2 * Math.sin(smallestGap / 2)));

    const raw = tiles.map((t) => ({ x: t.pos.dx * radiusTiles, y: t.pos.dy * radiusTiles }));
    const xs = raw.map((p) => p.x);
    const ys = raw.map((p) => p.y);
    const minX = Math.min(...xs, 0);
    const minY = Math.min(...ys, 0);
    return {
        radiusTiles,
        widthTiles: Math.max(...xs, 0) - minX + 1,
        heightTiles: Math.max(...ys, 0) - minY + 1,
        centers: raw.map((p) => ({ x: p.x - minX + 0.5, y: p.y - minY + 0.5 })),
    };
}

/** What the stage renders: the compass rose or the flat cycle grid. */
export type LayoutMode = "rose" | "grid";

/** A rose cell. `facing` is the DISPLAY facing - the sequence's own tag, or the IE slot facing for an
 *  untagged BAM cycle (whose seq.facing is "none") - and is unique within one rose. */
export interface RoseTile {
    seq: SequenceView;
    pos: RosePosition;
    facing: Facing;
}

export interface GridTile {
    seq: SequenceView;
    index: number;
    /**
     * The direction this tile draws, where the caller resolved one.
     *
     * An IE cycle carries no facing of its own, so a grid built straight from a file's sequences has
     * none and labels by index. A caller that already knows the band - the gallery, which resolves it
     * host-side from the animation's declared type - passes it here rather than letting the label claim
     * a cycle number the tile's position does not name.
     */
    facing?: Facing;
}

type CompassLayout = { mode: "compass"; tiles: RoseTile[] };
type GridLayout = { mode: "grid"; tiles: GridTile[] };

/**
 * Compass rose when every sequence maps to a unique compass facing (FRM's 6, or an 8-facing BAM);
 * grid fallback otherwise (non-directional, or duplicate facings, which cannot share one position).
 */
/** True when every sequence references the exact same frames - a single-orientation FRM (all six
 *  rotation slots share one data offset) or a degenerate all-identical animation. */
function allSequencesShareFrames(sequences: SequenceView[]): boolean {
    const [first, ...rest] = sequences;
    if (!first) return false;
    return rest.every(
        (seq) =>
            seq.frameRefs.length === first.frameRefs.length &&
            seq.frameRefs.every((ref, i) => ref === first.frameRefs[i]),
    );
}

export function layoutSequences(view: AnimationView): CompassLayout | GridLayout {
    // Single-orientation FRM: all six rotation slots share one data offset, so the parser gives every
    // sequence the SAME frames (differing only by facing). A 6-cell rose of identical sprites is noise -
    // collapse to one cell. The model keeps its six shared rotations, so the save stays faithful.
    if (view.sequences.length > 1 && allSequencesShareFrames(view.sequences)) {
        const [first] = view.sequences;
        return { mode: "grid", tiles: first ? [{ seq: first, index: 0 }] : [] };
    }

    const facings = view.sequences.map((seq) => seq.facing);
    const allCompass = facings.every((facing) => compassPosition(facing) !== undefined);
    const allUnique = new Set(facings).size === facings.length;

    if (allCompass && allUnique) {
        const tiles = view.sequences.flatMap((seq) => {
            const pos = compassPosition(seq.facing);
            return pos === undefined ? [] : [{ seq, pos, facing: seq.facing }];
        });
        return { mode: "compass", tiles };
    }

    return { mode: "grid", tiles: view.sequences.map((seq, index) => ({ seq, index })) };
}

/**
 * Which layout a fresh open shows.
 *
 * Rose whenever the file's structure says it holds directions: tagged compass facings (FRM), or an IE
 * interpretation that found MORE THAN ONE direction block. The block count is the discriminator rather
 * than the interpretation's own `detected` fingerprint, because the two answer different questions:
 * `detected` decides what the file is DECLARED to be, is stamped at parse and read by the save path, and
 * is conservative on purpose - a file it rejects can still plainly be direction blocks, and both shipped
 * installs carry such files. Being wrong about the declaration writes bad blocks; being wrong about the
 * default costs one click, so the default reads the weaker structural signal. Block count separates the
 * corpus cleanly: no single-block animation in either install is a character or is detected.
 */
export function defaultLayoutMode(
    facingLayout: CompassLayout | GridLayout | null,
    ieDirections: IeDirectionAnalysis | undefined,
): LayoutMode {
    if (facingLayout?.mode === "compass") return "rose";
    return ieDirections !== undefined && ieDirections.groups.length > 1 ? "rose" : "grid";
}

/**
 * The first direction block that draws anything, or 0 where none does.
 *
 * A file of a packed family carries every block of that family's skeleton and draws only the one its own
 * name promises, so opening on block 0 shows a character file's placeholders - a stage of single pixels,
 * which reads as a broken editor rather than as "this block is not the one".
 */
export function firstDrawnBlock(view: AnimationView, interpretation: IeDirectionAnalysis): number {
    const areas = view.frames.map((frame) => frame.width * frame.height);
    const at = interpretation.groups.findIndex((slots) =>
        slots.some((slot) => cycleDrawsArt(view.sequences[slot.seqIndex]?.frameRefs ?? [], areas)),
    );
    return at === -1 ? 0 : at;
}

/** Rose tiles for one direction block of an IE-interpreted untagged BAM (@bgforge/image/ie-direction). */
export function ieRoseTiles(view: AnimationView, interpretation: IeDirectionAnalysis, group: number): RoseTile[] {
    const slots: readonly IeDirectionSlot[] = interpretation.groups[group] ?? [];
    return slots.flatMap((slot) => {
        const seq = view.sequences[slot.seqIndex];
        const pos = compassPosition(slot.facing);
        return seq && pos ? [{ seq, pos, facing: slot.facing }] : [];
    });
}
