/**
 * An animation set's stances: what a viewer lists, and which cycles each one draws.
 *
 * A stance is a direction BAND - one action stored as consecutive cycles, one per facing. Where that
 * band lives varies by layout: an action-code animation gives each stance its own file, while a `G` file
 * packs several as consecutive bands. Both arrive here as (file, band index), so a viewer offers one
 * uniform list and never makes the reader think in files.
 *
 * Naming is deliberately split. A file whose suffix names its stance is labelled by `members.ts`; the
 * bands inside a multi-stance file are labelled by the block table the image editor already uses, so the
 * two surfaces name the same block identically. Where neither pins a name, the band is numbered - the
 * same posture that table takes, and for the same reason.
 */
import { type SequenceCode, type WideBand, blockSequences, ieGroups } from "../group-labels";
import { type IeDirectionSlot, type IeScheme } from "@bgforge/image/ie-direction";
import { type SchemeMember } from "./members";
import { type NeutralActionId, type NeutralActionRef } from "./actions";

/**
 * Sections whose files band at sixteen cycles rather than eight or nine.
 *
 * Structural inference cannot tell these apart on its own - a sixteen-cycle band divides evenly into two
 * eight-slot blocks, so such a file reads as twice as many stances at half the facings, and the reading
 * looks sound because each half IS uniform. Nothing structural can settle it, so the membership comes from
 * the schemes' own documented orientation lists: these three publish sixteen, every other section that
 * resolves publishes eight or nine.
 */
const WIDE_BAND_SECTIONS = new Set(["monster_quadrant", "monster_large16", "town_static"]);

const WIDE_BAND_STRIDE = 16;

/**
 * Sections whose sixteen slots hold eight pictures unless the animation declares a smooth path.
 *
 * `path_smooth` is declared by the two tiled families alone, and its absence is the coarse reading rather
 * than the fine one - the engine and the reference browser both default it off, and a classic archive
 * declares nothing at all. Confirmed against the art: in every wide-band file measured on both installs the
 * slots pair off, neighbouring slots opening on byte-identical frames.
 */
const SMOOTH_PATH_SECTIONS = new Set(["monster_quadrant", "multi_new"]);

/** Whether a band's sixteen slots hold eight facings doubled rather than sixteen distinct ones. */
export function coarseBands(section: string | undefined, pathSmooth: boolean | undefined): boolean {
    return section !== undefined && SMOOTH_PATH_SECTIONS.has(section) && pathSmooth !== true;
}

/**
 * Sections whose bands are eight cycles with every facing DRAWN rather than mirrored.
 *
 * Inference reads a LONE base file correctly: its eastern slots are dummies, and that is precisely the
 * fingerprint it looks for. Merged with the `*E` companion those slots hold real art, so the fingerprint
 * fails - correctly, it is no longer a base file - and the reading would fall back to an unnamed cycle
 * list, losing the fact that the eastern art is eastern. The section already settles it. Measured on a
 * classic install: every member carrying an `*E` companion is declared in this section.
 */
const PAIRED_BAND_SECTIONS = new Set(["character_old"]);

const IE_BAND_STRIDE = 8;

/** The stride a section settles, or undefined to leave the reading to structural inference. */
export function declaredStride(section: string | undefined): number | undefined {
    if (section === undefined) return undefined;
    if (WIDE_BAND_SECTIONS.has(section)) return WIDE_BAND_STRIDE;
    return PAIRED_BAND_SECTIONS.has(section) ? IE_BAND_STRIDE : undefined;
}

/**
 * The block scheme a declared stride implies, where one covers it.
 *
 * An eight-cycle band is the eight-slot scheme whether or not the eastern slots are drawn, so its bands
 * keep the block table's own stance names. A sixteen-cycle band matches no scheme the table knows, which
 * is why those bands are numbered instead.
 */
export function schemeForStride(stride: number): IeScheme | undefined {
    return stride === IE_BAND_STRIDE ? "ie8" : undefined;
}

/**
 * How the facings on a band were arrived at.
 *
 * `declared` means the animation's own type settled the stride, or the parse recognised the scheme's
 * fingerprint outright. `inferred` means the facings were assigned from block structure alone, which is
 * all a lone file offers - a reading good enough to draw, and not good enough for a converter to write a
 * target's direction slots from without saying so.
 */
export type BandConfidence = "declared" | "inferred";

/** One file's cycles, already cut into direction bands. */
export interface FileBands {
    bands: readonly (readonly IeDirectionSlot[])[];
    /**
     * Which bands hold art, one per band.
     *
     * A packed file carries every band of its family's skeleton and draws the one its own name promises, so
     * without this a file of eleven bands lists eleven stances of which one draws anything - and everything
     * downstream, a conversion's loss report included, then speaks about ten that are not there.
     */
    drawn: readonly boolean[];
    /** The block scheme, where one was resolved - what the block table keys its names on. */
    scheme: IeScheme | undefined;
    confidence: BandConfidence;
}

/** One row of the viewer's stance list. */
export interface SetStance {
    /** What the sidebar shows. */
    label: string;
    /**
     * Which sequence of the band this row is, where the block table names one.
     *
     * A band the engine plays for several sequences is several rows over the same cycles, so the band index
     * alone no longer identifies a row - this is what separates them. Absent on a numbered band, which names
     * no sequence to be one of.
     */
    code?: SequenceCode;
    /**
     * Set where this stance is the band drawn back to front.
     *
     * Getting up is the dying band reversed, in every family that names it. Without this the row would be
     * the dying row under another name, which is a worse answer than not offering it at all.
     */
    reversed?: true;
    /** What the member this band belongs to depicts - see `SchemeMember.action`. */
    action: NeutralActionRef;
    /** The file this band's cycles live in - what "open this" means, and what the bands were read from. */
    resref: string;
    /**
     * Every file the stance draws, `resref` first.
     *
     * One file for almost everything; four for a quadrant animation, whose quarters compose into a single
     * picture. The parts share a cycle structure, so one band index addresses the same moment in each.
     */
    parts: readonly string[];
    /** Which band of that file, counting from zero. */
    band: number;
    /**
     * The band's cycles: which stored sequence draws each facing.
     *
     * Carried rather than counted because the rose needs the sequence indices to lay tiles out, and a
     * separate count would be a second statement of the same fact.
     */
    slots: readonly IeDirectionSlot[];
    /** How the facings were arrived at - see `BandConfidence`. */
    confidence: BandConfidence;
}

/**
 * Every stance a set's members offer, in member order.
 *
 * `bandsFor` bands one MEMBER - every file it draws, not only the first. Which facings a band stores is
 * read off content, so a member whose art is split across files has to be banded as the whole picture:
 * banding the first file alone reports the facings that file happens to hold. A member it cannot answer
 * for is dropped rather than listed, since a row that resolves to nothing is worse than no row. Bands
 * with no drawable facing go the same way.
 *
 * `section` is the animation's own declared type, passed on to the block table: several sections pack
 * different stances into the same token, scheme and block count, so without it those files take another
 * family's names.
 */
/**
 * An overlay file's bands: the member it overlays, cut to the blocks its own cycles reach.
 *
 * The geometry is the base's by construction - an overlay is drawn over it facing for facing - and the
 * overlay's own files cannot always supply it: the burrowing family's is one still per cycle, which
 * leaves the block reader nothing to cut on and came back three facings short of its base.
 *
 * A shorter overlay carries a PREFIX of the base's blocks, the same rule a shorter file of a family
 * takes, so a block whose cycles it does not have is dropped rather than left addressing past its end.
 * Measured across both installs: eight of the nine overlay members match their base's cycle count
 * exactly, and Volo's stores five of its base's six blocks.
 *
 * Matching the base's BANDS is not matching its drawn facings, and one overlay looks like a defect for
 * that reason: Volo's weapon twin holds a copy of the western art where its base's twin holds the eastern
 * facings, so that member draws five facings from an eight-slot band. It is what the install ships.
 */
export function bandsOverlaying(base: FileBands, cycleCount: number): readonly (readonly IeDirectionSlot[])[] {
    return base.bands.filter((slots) => slots.every((slot) => slot.seqIndex < cycleCount));
}

export function stancesOfMembers(
    members: readonly SchemeMember[],
    bandsFor: (member: SchemeMember, overlaying?: FileBands) => FileBands | undefined,
    section?: string,
): SetStance[] {
    const stances: SetStance[] = [];
    // A member that overlays another is banded from it, so the base's reading has to be in hand first.
    // Members arrive base-first (`setMembers` appends the layers), and a layer whose base was dropped
    // falls back to its own files rather than vanishing with it.
    const banded = new Map<string, FileBands>();
    for (const member of members) {
        const file = bandsFor(member, member.overlays === undefined ? undefined : banded.get(member.overlays));
        if (file === undefined) continue;
        banded.set(member.resref, file);
        // The resref first, then the member's own label: a split-part file carries its stance group in the
        // middle of its name, where no trailing-token match can reach it, and the label is that group.
        const groups = ieGroups([member.resref, member.label], file.bands.length, blockScheme(file, section), section);
        for (const [band, slots] of file.bands.entries()) {
            // The index is kept as it stands: a filtered band is still where it was in the file, and that
            // position is what addresses it there. A band the scheme addresses no sequence to goes with the
            // undrawn ones - it is padding the format forces on the file, and it holds a frame per facing,
            // so only the declaration can rule it out.
            if (slots.length === 0 || file.drawn[band] !== true || groups?.[band]?.unused === true) continue;
            const group = groups?.[band];
            // One row per sequence the band is played for. A band the table does not name yields no
            // sequences and so one nameless row, which is the numbered case.
            const sequences = group === undefined ? [] : blockSequences(group);
            for (const sequence of sequences.length === 0 ? [undefined] : sequences) {
                stances.push({
                    label: bandLabel(member, sequence?.name, band, file.bands.length),
                    ...(sequence === undefined ? {} : { code: sequence.code }),
                    ...(sequence?.reversed === true ? { reversed: true as const } : {}),
                    action: bandAction(member.action, sequence?.id, group?.detail),
                    resref: member.resref,
                    parts: member.parts,
                    band,
                    slots,
                    confidence: file.confidence,
                });
            }
        }
    }
    return stances;
}

/**
 * Which block table to look this file up in.
 *
 * The file's own scheme, or - for the three sections whose bands are sixteen cycles wide - the width, which
 * no eight-slot scheme covers. Derived from the same declaration that made the band wide rather than from
 * the slots read back, so a coarse reading that folds sixteen slots into eight facings still finds its
 * table. Kept out of `FileBands.scheme`, which is a real block scheme and travels to the webview as one.
 */
function blockScheme(file: FileBands, section: string | undefined): IeScheme | WideBand | undefined {
    if (file.scheme !== undefined) return file.scheme;
    return declaredStride(section) === WIDE_BAND_STRIDE ? "ie16" : undefined;
}

/**
 * A single-band file is its own stance; a named band takes its sequence's name, else a number.
 *
 * That name says nothing about WHICH file it came from, so a set drawing a second set of files under the
 * same scheme would name both runs identically - eight pairs of colliding labels on the burrowing family,
 * pointing at different files. Only that branch needs the layer: the other two lead with the member's own
 * name, which already carries it.
 *
 * The FILE never appears in any of the three: a stance list spans a set's files, and which one holds a
 * given stance is a convention of the naming family rather than anything a reader chose. The one exception
 * is the nameless band, where the file plus a position is all there is to identify it by.
 */
function bandLabel(member: SchemeMember, name: string | undefined, band: number, bandCount: number): string {
    // The block table first, whatever the band COUNT. Answering from the member as soon as a file holds one
    // band skipped the table for exactly the files that most need it: a tiled creature stores its walk in a
    // file of its own, so the walk kept the file's name and a dragon's list opened on a row reading "G1".
    if (name !== undefined) return member.layer === undefined ? name : `${name} (${member.layer})`;
    if (bandCount === 1) return member.name;
    return `${member.label} - group ${band + 1}`;
}

/**
 * What one row depicts.
 *
 * A packed file's name says which FILE the block lives in, and the block table says what the row is - so
 * where the table pins it, the row's own meaning beats the file's. That is the difference between a
 * converter that can file a walk under the target's walk and one that only knows the file was `G1`. The
 * code stays the file's: within its own scheme this band goes back where it came from, and the file is
 * where that is. `detail` is the BLOCK's, since it qualifies the band rather than one sequence of it.
 */
function bandAction(file: NeutralActionRef, id: NeutralActionId | undefined, detail?: string): NeutralActionRef {
    if (id === undefined) return file;
    return { scheme: file.scheme, id, code: file.code, ...(detail === undefined ? {} : { detail }) };
}
