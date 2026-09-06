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
import { isBamc } from "@bgforge/image";
import {
    type AnimationIndexResolver,
    type AnimationSet,
    type SchemeMember,
    type StanceIo,
    armourLabel,
    armourLevels,
    firstArmour,
    schemeForStride,
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
    /** `flavour` is the install this was read from, which the neutral model records on a conversion. */
    { kind: "set"; set: AnimationSet; io: StanceIo; flavour: string } | { kind: "no-game" } | { kind: "not-declared" };

/**
 * The sets an install declares: one by address, and the whole list.
 *
 * Both halves rather than a lookup alone, because the editor's own set picker offers the list - and a
 * second resolver for it would build the index twice and hold two copies of the answer.
 */
export interface AnimationSetSource {
    lookup(gameDir: string, id: number): AnimationSetLookup;
    /** Every set the install declares, in index order. Empty outside a game. */
    list(gameDir: string): readonly AnimationSet[];
}

/**
 * Resolve a set against whichever install `gameDir` names.
 *
 * Asked per open rather than captured: a document survives the game being closed and another opened, and a
 * set resolved against the previous install would draw one game's animation under another's address.
 *
 * Through `gameAt`, which OPENS the configured install when nothing is open yet, rather than through the
 * already-open session: a `.animset` tab reopened with the window restores before the resource view is first
 * shown, and reading the session alone refused a set the gallery had listed moments earlier. Undefined stays
 * "no game", which is what a different install being open means.
 */
export function createAnimationSetSource(deps: {
    animations: AnimationIndexResolver;
    gameAt: (dir: string) => Game | undefined;
}): AnimationSetSource {
    return {
        lookup: (gameDir, id) => {
            const game = deps.gameAt(gameDir);
            if (game === undefined) return { kind: "no-game" };
            const set = (deps.animations(gameDir) ?? []).find((entry) => entry.id === id);
            return set === undefined
                ? { kind: "not-declared" }
                : { kind: "set", set, io: stanceIo(game), flavour: game.identity.flavour };
        },
        // Not gated on the game being open: the index resolver opens the configured install itself, the
        // same way the lookup above does.
        list: (gameDir) => deps.animations(gameDir) ?? [],
    };
}

/**
 * What a pick did. Three states rather than a boolean because the two failures differ: showing what is
 * already shown is not a failure at all, and reporting it as one would put an error in front of a reader
 * who did nothing wrong.
 */
export type SetPick = "changed" | "unchanged" | "refused";

/**
 * One armour level's resolved actions.
 *
 * Actions are MEMBERS - one per file - not stances: a creature file packs several direction bands, and the
 * editor already has a control for picking between those. Listing stances here would offer the same choice
 * twice, and their resrefs collide, so a picker keyed on one could not address a row.
 */
interface ArmourLevel {
    level: number;
    actions: SchemeMember[];
}

/** One loaded member: the action it stands for, and the model the editor draws and edits. */
interface OpenAction {
    action: SchemeMember;
    model: ImageDocumentModel;
}

/**
 * Every member loaded so far, by the file it draws.
 *
 * Held across armour levels rather than per level, because a model carries its own unsaved edits: a cache
 * scoped to the open level would discard them the moment the reader changed armour, and the picture would
 * come back from the archive as if nothing had been done to it. Resrefs are unique across levels, since
 * the level is part of the name.
 */
type MemberModels = Map<string, OpenAction>;

function modelFor(io: StanceIo, models: MemberModels, action: SchemeMember): ImageDocumentModel | undefined {
    const cached = models.get(action.resref);
    if (cached !== undefined) return cached.model;
    const model = stanceModel(io, action);
    // The action is cached beside its model because a model outlives the armour level it was loaded
    // under, and a save needs the FILES it draws - which a resref alone does not give for a quadrant.
    if (model !== undefined) models.set(action.resref, { action, model });
    return model;
}

/**
 * The first action of `level` whose files parse, with its model.
 *
 * Not simply the first action: the member list is resolved against the archive's index, which says a file
 * is there without saying it can be decoded - and an action that cannot be drawn is not one to open on.
 */
function firstDrawn(io: StanceIo, models: MemberModels, level: ArmourLevel): OpenAction | undefined {
    for (const action of level.actions) {
        const model = modelFor(io, models, action);
        if (model !== undefined) return { action, model };
    }
    return undefined;
}

function resolveLevel(set: AnimationSet, io: StanceIo, level: number): ArmourLevel {
    return { level, actions: setMembers(set, level, io.exists) };
}

export class AnimationSetState {
    readonly set: AnimationSet;
    private readonly io: StanceIo;
    private readonly models: MemberModels;
    private current: ArmourLevel;
    private open: OpenAction;

    private constructor(set: AnimationSet, io: StanceIo, models: MemberModels, level: ArmourLevel, open: OpenAction) {
        this.set = set;
        this.io = io;
        this.models = models;
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
    /**
     * Why `open` returned nothing, in the reader's terms.
     *
     * Two different facts sit behind one empty set, and they ask different things: a set this names no
     * files for is a gap in what the editor models, one whose files are absent is a gap in the install.
     * The scheme carries the first in its own words, since only it knows what is unmodelled - and a set
     * with no layout is exactly the case `setMembers` can name nothing for.
     */
    static refusal(set: AnimationSet, hex: string): string {
        return set.scheme.kind === "unimplemented" && set.layout === undefined
            ? `Cannot show animation ${hex}: ${set.scheme.reason}.`
            : `This install ships no files for animation ${hex}.`;
    }

    static open(set: AnimationSet, io: StanceIo, armour?: number): AnimationSetState | undefined {
        const levels = armourLevels(set);
        const chosen = armour !== undefined && levels.includes(armour) ? armour : (firstArmour(set) ?? 1);
        const level = resolveLevel(set, io, chosen);
        const models: MemberModels = new Map();
        const first = firstDrawn(io, models, level);
        return first === undefined ? undefined : new AnimationSetState(set, io, models, level, first);
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
        const model = modelFor(this.io, this.models, action);
        if (model === undefined) return "refused";
        this.open = { action, model };
        return "changed";
    }

    /**
     * Every loaded member the reader has changed, with the files it draws.
     *
     * The whole set is not written back on every save: a set is a dozen files, and copying all of them
     * into the game's override folder over one edit puts eleven unrequested copies there. Order is load
     * order, which is stable within a session and is what a save's own report reads back.
     */
    editedMembers(): OpenAction[] {
        return [...this.models.values()].filter((member) => member.model.edited);
    }

    /**
     * How one of a member's files is stored, so a save writes each back in the encoding it was read in.
     *
     * A compressed file rewritten uncompressed still loads, but it is not the file the install shipped -
     * and a member drawn from two files is written by splitting one model, so each half has to be asked
     * separately rather than inheriting the model's own source format.
     */
    storedFormat(resref: string): "bam" | "bamc" {
        const bytes = this.io.read(resref);
        return bytes !== undefined && isBamc(bytes) ? "bamc" : "bam";
    }

    /**
     * Replace a member's model with one restored from a hot-exit backup.
     *
     * Ignores a resref this set does not draw: the install can have changed since the backup was written,
     * and a member it no longer has is better dropped than restored under a name nothing will save to.
     */
    restoreMember(resref: string, model: ImageDocumentModel): void {
        const known = this.models.get(resref);
        const action =
            known?.action ??
            armourLevels(this.set)
                .flatMap((level) => resolveLevel(this.set, this.io, level).actions)
                .find((candidate) => candidate.resref === resref);
        if (action === undefined) return;
        this.models.set(resref, { action, model });
        if (this.open.action.resref === resref) this.open = { action, model };
    }

    /**
     * Re-read this level's members from the game, dropping every cached model.
     *
     * Stays on the open action where it still draws, since a revert should not move the picker. False -
     * keeping what is loaded - when nothing draws any more: the document must hold a model either way, and
     * a set whose files have just been removed is better shown stale than blank.
     */
    reload(): boolean {
        this.models.clear();
        const resolved = resolveLevel(this.set, this.io, this.current.level);
        const same = resolved.actions.find((candidate) => candidate.resref === this.open.action.resref);
        const model = same === undefined ? undefined : modelFor(this.io, this.models, same);
        const open =
            same !== undefined && model !== undefined
                ? { action: same, model }
                : firstDrawn(this.io, this.models, resolved);
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
        const resolved = resolveLevel(this.set, this.io, level);
        const first = firstDrawn(this.io, this.models, resolved);
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
        ...(state.set.section === undefined ? {} : { section: state.set.section }),
        ...(state.set.bandStride === undefined ? {} : { bands: declaredBands(state.set) }),
    };
}

/** A declared band width and the block scheme it implies, where one covers it. */
function declaredBands(set: AnimationSet): NonNullable<SetView["bands"]> {
    const stride = set.bandStride ?? 0;
    const scheme = schemeForStride(stride);
    return {
        stride,
        ...(scheme === undefined ? {} : { scheme }),
        ...(set.coarseBands === true ? { coarse: true as const } : {}),
    };
}
