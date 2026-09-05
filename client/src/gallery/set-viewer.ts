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
import { stanceIo, stanceModel } from "../image-editor/stance-model";
import { type AnimationView } from "../image-editor/webview/messages";
import { type AnimationSet, type SetStance, armourLevels, firstArmour, setStances, setTitle } from "@bgforge/animation";
import { type SetDetail } from "./webview/messages";

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
    const armours = armourLevels(set);
    const chosen = armour !== undefined && armours.includes(armour) ? armour : (firstArmour(set) ?? 1);
    const stances = setStances(set, chosen, stanceIo(game));
    return {
        detail: {
            id: set.id,
            title: setTitle(set),
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
 * One stance's animation, with only the frames that band draws carrying pixels.
 *
 * A creature file holds every stance at every facing, so packing all of it would send an order of
 * magnitude more pixels than the rose shows. The geometry of every frame still crosses - that is what lets
 * a tile be laid out before its pixels arrive - which is the same split the image editor's open uses.
 */
export function stanceAnimation(game: Game, stance: SetStance): AnimationView | undefined {
    const model = stanceModel(stanceIo(game), stance);
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
