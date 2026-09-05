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
import { type IeGroup, ieGroups } from "../group-labels";
import { type IeDirectionSlot, type IeScheme } from "@bgforge/image/ie-direction";
import { type SchemeMember } from "./members";
import { type NeutralActionRef } from "./actions";

/**
 * Sections whose files band at sixteen cycles rather than eight or nine.
 *
 * Structural inference cannot tell these apart on its own - a sixteen-cycle band divides evenly into two
 * eight-slot blocks, so such a file reads as twice as many stances at half the facings. Measured across
 * an install's own declarations, only these two sections carry the wide band; every other section that
 * resolves is the eight-stride shape inference already reads correctly, so nothing else is overridden.
 */
const WIDE_BAND_SECTIONS = new Set(["monster_quadrant", "monster_large16"]);

const WIDE_BAND_STRIDE = 16;

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
 */
export function stancesOfMembers(
    members: readonly SchemeMember[],
    bandsFor: (member: SchemeMember) => FileBands | undefined,
): SetStance[] {
    const stances: SetStance[] = [];
    for (const member of members) {
        const file = bandsFor(member);
        if (file === undefined) continue;
        const groups = ieGroups(member.resref, file.bands.length, file.scheme);
        for (const [band, slots] of file.bands.entries()) {
            // The index is kept as it stands: a filtered band is still where it was in the file, and that
            // position is what addresses it there.
            if (slots.length === 0 || file.drawn[band] !== true) continue;
            stances.push({
                label: bandLabel(member.label, groups?.[band]?.label, band, file.bands.length),
                action: bandAction(member.action, groups?.[band]),
                resref: member.resref,
                parts: member.parts,
                band,
                slots,
                confidence: file.confidence,
            });
        }
    }
    return stances;
}

/** A single-band file is its own stance; a packed one takes the block's name, else a number. */
function bandLabel(member: string, name: string | undefined, band: number, bandCount: number): string {
    if (bandCount === 1) return member;
    return name ?? `${member} - group ${band + 1}`;
}

/**
 * What a band depicts.
 *
 * A packed file's name says which FILE the block lives in, and the block table says what the block is -
 * so where the table names it, the band's own meaning beats the file's. That is the difference between a
 * converter that can file a walk under the target's walk and one that only knows the file was `G1`. The
 * code stays the file's: within its own scheme this band goes back where it came from, and the file is
 * where that is.
 */
function bandAction(file: NeutralActionRef, group: IeGroup | undefined): NeutralActionRef {
    if (group?.id === undefined) return file;
    return {
        scheme: file.scheme,
        id: group.id,
        code: file.code,
        ...(group.detail === undefined ? {} : { detail: group.detail }),
    };
}
