/**
 * An animation set as an editable document: one set, one armour level, one action open at a time.
 *
 * The editor shows a set through exactly the model it shows a single file through, so every control it
 * already has - zoom, rose, direction group, transport, save - keeps working unchanged. What a set adds is
 * the two pickers around that model, and the state they read is here.
 *
 * Members load per action rather than up front: a character set at one armour is roughly twenty BAM files
 * and a tiled set far more, and the editor draws one of them at a time.
 */
import { type Game } from "@bgforge/binary";
import {
    type AnimationIndexResolver,
    type AnimationSet,
    type SetStance,
    type StanceIo,
    armourLevels,
    firstArmour,
    setStances,
} from "@bgforge/animation";
import { type ImageDocumentModel } from "./document-model";
import { stanceIo, stanceModel } from "./stance-model";

/** The set a set-scoped URI names, with the io its members read through, or undefined outside that game. */
export type AnimationSetSource = (gameDir: string, id: number) => { set: AnimationSet; io: StanceIo } | undefined;

/**
 * Resolve a set against whichever install is open now.
 *
 * Asked per open rather than captured: a document survives the game being closed and another opened, and a
 * set resolved against the previous install would draw one game's animation under another's address.
 */
export function createAnimationSetSource(deps: {
    animations: AnimationIndexResolver;
    gameSession: () => { dir: string; game: Game } | undefined;
}): AnimationSetSource {
    return (gameDir, id) => {
        const current = deps.gameSession();
        if (current === undefined || current.dir !== gameDir) return;
        const set = (deps.animations(gameDir) ?? []).find((entry) => entry.id === id);
        return set === undefined ? undefined : { set, io: stanceIo(current.game) };
    };
}

/** One armour level's resolved actions, and the models already built for them. */
interface ArmourLevel {
    level: number;
    stances: SetStance[];
    models: Map<string, ImageDocumentModel>;
}

export class AnimationSetState {
    readonly set: AnimationSet;
    private readonly io: StanceIo;
    private current: ArmourLevel;
    private open: { stance: SetStance; model: ImageDocumentModel };

    private constructor(
        set: AnimationSet,
        io: StanceIo,
        level: ArmourLevel,
        open: { stance: SetStance; model: ImageDocumentModel },
    ) {
        this.set = set;
        this.io = io;
        this.current = level;
        this.open = open;
    }

    /**
     * Open a set at `armour`, on the first action that actually draws.
     *
     * Undefined when nothing does: an editor document has to have a model, and a set whose files this
     * install does not ship has nothing to put in one. The caller reports that rather than opening a tab
     * that would draw an empty frame.
     */
    static open(set: AnimationSet, io: StanceIo, armour?: number): AnimationSetState | undefined {
        const levels = armourLevels(set);
        const chosen = armour !== undefined && levels.includes(armour) ? armour : (firstArmour(set) ?? 1);
        const level = AnimationSetState.resolve(set, io, chosen);
        const first = AnimationSetState.firstDrawn(level, io);
        return first === undefined ? undefined : new AnimationSetState(set, io, level, first);
    }

    private static resolve(set: AnimationSet, io: StanceIo, level: number): ArmourLevel {
        return { level, stances: setStances(set, level, io), models: new Map() };
    }

    /**
     * The first action of `level` whose members parse, with its model.
     *
     * Not simply the first action: `setStances` lists a member on its cycle table alone, which a file can
     * carry while its frame data is unreadable - and an action that cannot be drawn is not one to open on.
     */
    private static firstDrawn(
        level: ArmourLevel,
        io: StanceIo,
    ): { stance: SetStance; model: ImageDocumentModel } | undefined {
        for (const stance of level.stances) {
            const model = AnimationSetState.modelFor(level, io, stance);
            if (model !== undefined) return { stance, model };
        }
        return undefined;
    }

    private static modelFor(level: ArmourLevel, io: StanceIo, stance: SetStance): ImageDocumentModel | undefined {
        const cached = level.models.get(stance.resref);
        if (cached !== undefined) return cached;
        const model = stanceModel(io, stance);
        if (model !== undefined) level.models.set(stance.resref, model);
        return model;
    }

    /** Every armour level the set declares, lowest first - what the armour picker offers. */
    get armours(): readonly number[] {
        return armourLevels(this.set);
    }

    get armour(): number {
        return this.current.level;
    }

    /** The actions this armour level draws, in the order the picker should list them. */
    get actions(): readonly SetStance[] {
        return this.current.stances;
    }

    get action(): SetStance {
        return this.open.stance;
    }

    get model(): ImageDocumentModel {
        return this.open.model;
    }

    /**
     * Show the action `resref` names. False - leaving the open action alone - when this level does not name
     * it, or when its members will not parse: the document must keep a model either way, and a picker
     * showing an action the editor could not draw is what the false answer is for.
     */
    select(resref: string): boolean {
        const stance = this.current.stances.find((candidate) => candidate.resref === resref);
        if (stance === undefined || stance.resref === this.open.stance.resref) return false;
        const model = AnimationSetState.modelFor(this.current, this.io, stance);
        if (model === undefined) return false;
        this.open = { stance, model };
        return true;
    }

    /**
     * Re-read this level's members from the game, dropping every cached model.
     *
     * Stays on the open action where it still draws, since a revert should not move the picker. False -
     * keeping what is loaded - when nothing draws any more: the document must hold a model either way, and
     * a set whose files have just been removed is better shown stale than blank.
     */
    reload(): boolean {
        const resolved = AnimationSetState.resolve(this.set, this.io, this.current.level);
        const same = resolved.stances.find((candidate) => candidate.resref === this.open.stance.resref);
        const model = same === undefined ? undefined : AnimationSetState.modelFor(resolved, this.io, same);
        const open =
            same !== undefined && model !== undefined
                ? { stance: same, model }
                : AnimationSetState.firstDrawn(resolved, this.io);
        if (open === undefined) return false;
        this.current = resolved;
        this.open = open;
        return true;
    }

    /**
     * Show `level`'s actions, opening on the first that draws. False - leaving the open level alone - when
     * the set does not declare it or this install ships none of its files.
     */
    selectArmour(level: number): boolean {
        if (level === this.current.level || !this.armours.includes(level)) return false;
        const resolved = AnimationSetState.resolve(this.set, this.io, level);
        const first = AnimationSetState.firstDrawn(resolved, this.io);
        if (first === undefined) return false;
        this.current = resolved;
        this.open = first;
        return true;
    }
}
