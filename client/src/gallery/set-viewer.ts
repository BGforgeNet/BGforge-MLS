/**
 * The viewer page's host half: one set's stance list, and one stance's animation.
 *
 * Both answers are built from the same `ImageDocumentModel` the image editor opens files through, so the
 * gallery's rose draws from exactly the view that editor draws from rather than a second decode path.
 *
 * Kept out of `panel.ts` because none of it needs a panel: this is a pure function of the open game, which
 * is what lets it be tested without a webview.
 */
import { type Game } from "@bgforge/binary";
import { composeQuadrants } from "@bgforge/image";
import { ImageDocumentModel } from "../image-editor/document-model";
import { type AnimationView } from "../image-editor/webview/messages";
import { type AnimationSet } from "../ie-resources/animation-index";
import { type SetStance } from "../ie-resources/animation-schemes/bands";
import { firstArmour, setStances, type StanceIo } from "./set-stances";
import { type SetDetail } from "./webview/messages";

function ioFor(game: Game): StanceIo {
    const read = (resref: string): Uint8Array | undefined => {
        if (!game.canRead(resref, "bam")) return undefined;
        try {
            return game.read(resref, "bam");
        } catch {
            // One unreadable member is a missing row, not a dead page - the posture the index takes too.
            return undefined;
        }
    };
    return { exists: (resref) => game.canRead(resref, "bam"), read };
}

/** The armour levels a set declares, lowest first. */
function armoursOf(set: AnimationSet): number[] {
    return [...set.prefixByArmour.keys()].sort((a, b) => a - b);
}

/** What the viewer page shows for one set, plus the stances the host keeps to answer `selectStance`. */
export interface ResolvedSet {
    detail: SetDetail;
    stances: SetStance[];
}

/**
 * Resolve one set for the viewer page.
 *
 * `armour` is honoured only when the set actually declares that level, so a stale pick carried over from a
 * previously-viewed set falls back to the lowest rather than emptying the page.
 */
export function resolveSet(game: Game, set: AnimationSet, armour?: number): ResolvedSet {
    const armours = armoursOf(set);
    const chosen = armour !== undefined && armours.includes(armour) ? armour : (firstArmour(set) ?? 1);
    const stances = setStances(set, chosen, ioFor(game));
    const title = set.name || set.code || `0x${set.id.toString(16).padStart(4, "0")}`;
    return {
        detail: {
            id: set.id,
            title,
            armours,
            armour: chosen,
            stances: stances.map((stance) => ({
                label: stance.label,
                resref: stance.resref,
                parts: [...stance.parts],
                band: stance.band,
                slots: stance.slots.map((slot) => ({ seqIndex: slot.seqIndex, facing: slot.facing })),
            })),
            ...(stances.length === 0
                ? {
                      note:
                          set.scheme.kind === "unimplemented"
                              ? set.scheme.reason
                              : "This install ships no files for this animation.",
                  }
                : {}),
        },
        stances,
    };
}

/**
 * The document this stance draws from - one file, or the four quarters of an oversized creature composed
 * into one animation.
 *
 * A quadrant animation's parts are pieces of a single sprite rather than alternatives, so drawing one of
 * them shows a corner. Composing needs every part to parse; a part that will not is dropped and the rest
 * still compose, which loses a quarter rather than the whole creature.
 */
function stanceModel(game: Game, stance: SetStance): ImageDocumentModel | undefined {
    const io = ioFor(game);
    const parts = stance.parts.flatMap((resref) => {
        const bytes = io.read(resref);
        if (bytes === undefined) return [];
        try {
            return [ImageDocumentModel.fromBytes(bytes, `${resref}.BAM`)];
        } catch {
            return [];
        }
    });
    const [first] = parts;
    if (first === undefined) return undefined;
    if (parts.length === 1) return first;

    const indexed = parts.flatMap((part) => {
        const animation = part.indexedAnimation();
        return animation === undefined ? [] : [animation];
    });
    const composed = indexed.length === parts.length ? composeQuadrants(indexed) : undefined;
    // Composition refuses parts whose cycles disagree. Falling back to the first part draws a corner,
    // which is wrong but visible - and better than a stance that silently draws nothing.
    return composed === undefined ? first : ImageDocumentModel.fromAnimation(composed, `${stance.resref}.BAM`);
}

/**
 * One stance's animation, with only the frames that band draws carrying pixels.
 *
 * A creature file holds every stance at every facing, so packing all of it would send an order of
 * magnitude more pixels than the rose shows. The geometry of every frame still crosses - that is what lets
 * a tile be laid out before its pixels arrive - which is the same split the image editor's open uses.
 */
export function stanceAnimation(game: Game, stance: SetStance): AnimationView | undefined {
    const model = stanceModel(game, stance);
    if (model === undefined) return undefined;
    // An empty `include` packs no pixels, so this first pass costs geometry only - it is here to read the
    // cycle table, which is what says which frames the band actually draws.
    const geometry = model.toView({ include: new Set<number>() });
    const include = new Set<number>();
    for (const slot of stance.slots) {
        for (const ref of geometry.sequences[slot.seqIndex]?.frameRefs ?? []) include.add(ref);
    }
    return model.toView({ include });
}
