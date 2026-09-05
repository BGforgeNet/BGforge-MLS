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
    type SchemeMember,
    type StanceIo,
    armourLabel,
    armourLevels,
    firstArmour,
    setMembers,
    setTitle,
} from "@bgforge/animation";
import { type ImageDocumentModel } from "./document-model";
import { type SetView } from "./webview/messages";
import { stanceIo, stanceModel } from "./stance-model";

/**
 * What a set address resolves to, or why it does not.
 *
 * The two failures are told apart because they ask different things of the reader: one is "open the game
 * this came from", the other is "this install has no such animation". Collapsing them into `undefined`
 * left the second reported as the first, which sent the reader looking for a game that was already open.
 */
export type AnimationSetLookup =
    | { kind: "set"; set: AnimationSet; io: StanceIo }
    | { kind: "no-game" }
    | { kind: "not-declared" };

/** Resolves the set a set-scoped URI names, against whichever install is open. */
export type AnimationSetSource = (gameDir: string, id: number) => AnimationSetLookup;

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
        if (current === undefined || current.dir !== gameDir) return { kind: "no-game" };
        const set = (deps.animations(gameDir) ?? []).find((entry) => entry.id === id);
        return set === undefined ? { kind: "not-declared" } : { kind: "set", set, io: stanceIo(current.game) };
    };
}

/**
 * What a pick did. Three states rather than a boolean because the two failures differ: showing what is
 * already shown is not a failure at all, and reporting it as one would put an error in front of a reader
 * who did nothing wrong.
 */
export type SetPick = "changed" | "unchanged" | "refused";

/**
 * One armour level's resolved actions, and the models already built for them.
 *
 * Actions are MEMBERS - one per file - not stances: a creature file packs several direction bands, and the
 * editor already has a control for picking between those. Listing stances here would offer the same choice
 * twice, and their resrefs collide, so a picker keyed on one could not address a row.
 */
interface ArmourLevel {
    level: number;
    actions: SchemeMember[];
    models: Map<string, ImageDocumentModel>;
}

export class AnimationSetState {
    readonly set: AnimationSet;
    private readonly io: StanceIo;
    private current: ArmourLevel;
    private open: { action: SchemeMember; model: ImageDocumentModel };

    private constructor(
        set: AnimationSet,
        io: StanceIo,
        level: ArmourLevel,
        open: { action: SchemeMember; model: ImageDocumentModel },
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
        return { level, actions: setMembers(set, level, io.exists), models: new Map() };
    }

    /**
     * The first action of `level` whose files parse, with its model.
     *
     * Not simply the first action: the member list is resolved against the archive's index, which says a
     * file is there without saying it can be decoded - and an action that cannot be drawn is not one to
     * open on.
     */
    private static firstDrawn(
        level: ArmourLevel,
        io: StanceIo,
    ): { action: SchemeMember; model: ImageDocumentModel } | undefined {
        for (const action of level.actions) {
            const model = AnimationSetState.modelFor(level, io, action);
            if (model !== undefined) return { action, model };
        }
        return undefined;
    }

    private static modelFor(level: ArmourLevel, io: StanceIo, action: SchemeMember): ImageDocumentModel | undefined {
        const cached = level.models.get(action.resref);
        if (cached !== undefined) return cached;
        const model = stanceModel(io, action);
        if (model !== undefined) level.models.set(action.resref, model);
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
    get actions(): readonly SchemeMember[] {
        return this.current.actions;
    }

    get action(): SchemeMember {
        return this.open.action;
    }

    get model(): ImageDocumentModel {
        return this.open.model;
    }

    /**
     * Show the action `resref` names.
     *
     * Refused where this level does not name it, or where its files will not parse: the document must keep
     * a model either way, so the open action stays and the caller reports what happened.
     */
    select(resref: string): SetPick {
        if (resref === this.open.action.resref) return "unchanged";
        const action = this.current.actions.find((candidate) => candidate.resref === resref);
        if (action === undefined) return "refused";
        const model = AnimationSetState.modelFor(this.current, this.io, action);
        if (model === undefined) return "refused";
        this.open = { action, model };
        return "changed";
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
        const same = resolved.actions.find((candidate) => candidate.resref === this.open.action.resref);
        const model = same === undefined ? undefined : AnimationSetState.modelFor(resolved, this.io, same);
        const open =
            same !== undefined && model !== undefined
                ? { action: same, model }
                : AnimationSetState.firstDrawn(resolved, this.io);
        if (open === undefined) return false;
        this.current = resolved;
        this.open = open;
        return true;
    }

    /**
     * Show `level`'s actions, opening on the first that draws. Refused - leaving the open level alone -
     * where the set does not declare that level or this install ships none of its files.
     */
    selectArmour(level: number): SetPick {
        if (level === this.current.level) return "unchanged";
        if (!this.armours.includes(level)) return "refused";
        const resolved = AnimationSetState.resolve(this.set, this.io, level);
        const first = AnimationSetState.firstDrawn(resolved, this.io);
        if (first === undefined) return "refused";
        this.current = resolved;
        this.open = first;
        return "changed";
    }
}

/** What the editor's two set controls read: the level and action lists, and which of each is open. */
export function setView(state: AnimationSetState): SetView {
    return {
        id: state.set.id,
        title: setTitle(state.set),
        armours: state.armours.map((level) => ({ level, label: armourLabel(level) })),
        armour: state.armour,
        actions: state.actions.map((action) => ({ label: action.label, resref: action.resref })),
        action: state.action.resref,
    };
}
