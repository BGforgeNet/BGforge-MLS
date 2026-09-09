/**
 * What the header band says about the animation open on the stage, beyond its filename.
 *
 * Four facts a reader cannot get from the picture: how many directions it covers, whether the file
 * actually stores them all, how many files were combined to make it, and what family the install
 * declared it under. The first three are the ones that surprise: a combined base and eastern twin looks
 * exactly like a file that stored all eight facings itself, and a nine-cycle band draws sixteen.
 *
 * Every one is read off a DECLARED property - the resolved block scheme, the set's declared band width,
 * the document's own composition count, the install's section - never off the picture's shape or off
 * another label's prose.
 */
import { IE_STRIDE, IE_WEST_SLOTS, ieBlockSize } from "@bgforge/image/ie-direction";
import type { AnimationView } from "../messages";
import type { DirectionBlocks } from "./compass-layout";

export interface AnimationFact {
    /** Stable across relabelling - what the markup keys on, and what a test asks for. */
    id: string;
    label: string;
    /** What the two-word label cannot carry. */
    title: string;
}

/**
 * How a band's cycles map onto compass directions.
 *
 * `stored` is what the file holds per band, `shown` what the engine draws from it. They differ for the
 * nine-cycle scheme, whose stored cycles cover the western half of a sixteen-point wheel while the
 * engine mirrors the eastern seven.
 */
interface Directions {
    stored: number;
    shown: number;
}

/**
 * The sixteen-point wheel the finer scheme draws, which is the one number here no scheme states: `ie9`
 * names its nine STORED cycles, and what the engine makes of them is twice the western arc less its poles.
 * Everything else comes from the schemes themselves rather than being restated - "ie9 means nine" has one
 * home, and a second copy of it drifts the first time a scheme is edited.
 */
const IE_WHEEL = 16;

/**
 * The directions this animation covers, or undefined where its cycles are not directions at all.
 *
 * An FRM tags its own rotations, so it is answered from the sequences themselves; everything else comes
 * from the block reading App already resolved, which is where the declared band width has already won
 * over structural inference.
 */
function directionsOf(view: AnimationView, blocks: DirectionBlocks | undefined): Directions | undefined {
    if (view.sourceFormat === "frm") {
        const tagged = new Set(view.sequences.map((sequence) => sequence.facing).filter((f) => f !== "none"));
        return tagged.size === 0 ? undefined : { stored: tagged.size, shown: tagged.size };
    }
    if (blocks === undefined) return undefined;
    if (blocks.scheme === "ie9") {
        // Asked of the scheme rather than written here, so it cannot answer differently from the reader
        // that resolved the blocks; a scheme that names no size says nothing rather than a padded guess.
        const stored = ieBlockSize("ie9");
        return stored === undefined ? undefined : { stored, shown: IE_WHEEL };
    }
    if (blocks.scheme === "ie8") return { stored: IE_STRIDE, shown: IE_STRIDE };
    // A declared band the schemes do not cover - a sixteen-wide one, which stores every facing itself.
    const stride = view.set?.bands?.stride;
    return stride === undefined ? undefined : { stored: stride, shown: stride };
}

/**
 * How many of the shown directions the files actually hold.
 *
 * The eight-slot scheme is the one that depends on the document rather than on the format: a lone base
 * file carries art in its five western slots and leaves the eastern three for the engine to mirror,
 * while the same member combined with its `E` twin has all eight. Nothing in the combined picture says
 * which it was, which is the whole reason this is carried from the host.
 */
function drawnDirections(view: AnimationView, blocks: DirectionBlocks | undefined, directions: Directions): number {
    if (blocks?.scheme === "ie8" && view.composedFiles < 2) return IE_WEST_SLOTS;
    return directions.stored;
}

function fileWord(count: number): string {
    return count === 1 ? "1 file" : `${count} files`;
}

function compositionTitle(count: number): string {
    if (count === 1) return "One file on disk holds this whole picture";
    return `This picture is ${count} files on disk, combined on open and written back over all of them`;
}

export function animationFacts(input: { view: AnimationView; blocks: DirectionBlocks | undefined }): AnimationFact[] {
    const { view, blocks } = input;
    const facts: AnimationFact[] = [];

    const directions = directionsOf(view, blocks);
    if (directions === undefined) {
        facts.push({
            id: "directions",
            label: "no directions",
            title: "These cycles are not a direction band - the animation faces one way",
        });
    } else {
        facts.push({
            id: "directions",
            label: `${directions.shown} directions`,
            title: `The engine draws ${directions.shown} facings from this band`,
        });
        // Only when something IS mirrored. A header says what is unusual about this animation; a chip
        // reading "all stored" on every file that stores its own facings is the normal case taking up
        // room, and it made the mirrored case harder to spot rather than easier.
        const drawn = drawnDirections(view, blocks, directions);
        if (drawn < directions.shown) {
            facts.push({
                id: "mirrored",
                label: "east mirrored",
                title: `${drawn} of ${directions.shown} facings are stored; the engine mirrors the rest`,
            });
        }
    }

    facts.push({
        id: "files",
        label: fileWord(view.composedFiles),
        title: compositionTitle(view.composedFiles),
    });

    // Both spelled host-side, like the armour and stance labels beside them in the same view: the section
    // vocabulary is the animation package's, and a webview keeping its own copy would be a second
    // statement of it that goes stale on the first table edit. The title is a whole sentence because the
    // label is the install's own words and answers nothing on its own - "Monster, layered spell" needs
    // telling which engine says so, under what token, and what its files look like.
    const family = view.set?.familyLabel;
    if (family !== undefined) {
        facts.push({ id: "family", label: family, title: view.set?.familyTitle ?? family });
    }
    return facts;
}
