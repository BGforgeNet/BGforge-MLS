/**
 * An animation set as an editable document: one set, one armour level, one stance open at a time.
 *
 * The editor shows a set through exactly the model it shows a single file through, so every control it
 * already has - zoom, rose, transport, save - keeps working unchanged. What a set adds is the two pickers
 * around that model, and the state they read is here. It also TAKES one: a set names the direction band
 * itself, so the block picker a lone file keeps is a choice this surface has already made.
 *
 * Models load per file rather than up front: a character set at one armour is roughly twenty BAM files and
 * a tiled set far more, and the editor draws one of them at a time. The stance LIST is eager, because it
 * costs cycle tables rather than pixels.
 */
import { type Game } from "@bgforge/binary";
import { type Facing, isBamc } from "@bgforge/image";
import {
    type AnimationIndexResolver,
    type AnimationSet,
    type SchemeMember,
    type SetStance,
    type StanceIo,
    armourLabel,
    drawnArmourLevels,
    familyDescription,
    firstArmour,
    overlaidStride,
    namingForLayout,
    schemeForStride,
    sectionLabel,
    sectionOptions,
    setMembers,
    setStances,
    setTitle,
    stanceIo,
} from "@bgforge/animation";
import { type IeScheme, IE_STRIDE, IE_WEST_SLOTS, ieBlockSize, ieFacingsForStride } from "@bgforge/image/ie-direction";
import { type ImageDocumentModel } from "./document-model";
import { type SetView } from "./webview/messages";
import { stanceModel } from "./stance-model";
import { IE_NAMINGS, NAMING_LABELS, sectionIsReachable } from "./conversion";

/** Facings in the whole sixteen-point wheel - what a set storing every one of them holds. */
const IE_WHEEL_SLOTS = 16;

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
    /**
     * Every set drawing the install's file `resref`, in index order. Empty outside a game.
     *
     * A list, not a set: recoloured creatures and class variants of one body share their files, so one file
     * routinely belongs to several.
     */
    drawnBy(gameDir: string, resref: string): readonly AnimationSet[];
}

/**
 * Which sets draw each file, over one install's index: its members at every armour level they draw.
 *
 * Built once per index rather than per file opened, because inverting a whole install walks every set's
 * members and probes the archive for each.
 */
function invertIndex(sets: readonly AnimationSet[], io: StanceIo): Map<string, AnimationSet[]> {
    const drawers = new Map<string, AnimationSet[]>();
    for (const set of sets) {
        const files = new Set<string>();
        for (const level of drawnArmourLevels(set, io.exists)) {
            for (const member of setMembers(set, level, io.exists)) {
                for (const part of member.parts) files.add(part.toUpperCase());
            }
        }
        for (const file of files) {
            const list = drawers.get(file);
            if (list === undefined) drawers.set(file, [set]);
            else list.push(set);
        }
    }
    return drawers;
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
    // Keyed by the index itself: the resolver hands back one array per install for as long as it caches it,
    // so a different install - or the same one re-read - is a different key and never a stale answer.
    const inverted = new WeakMap<readonly AnimationSet[], Map<string, AnimationSet[]>>();
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
        drawnBy: (gameDir, resref) => {
            const sets = deps.animations(gameDir);
            const game = deps.gameAt(gameDir);
            if (sets === undefined || game === undefined) return [];
            let drawers = inverted.get(sets);
            if (drawers === undefined) {
                drawers = invertIndex(sets, stanceIo(game));
                inverted.set(sets, drawers);
            }
            return drawers.get(resref.toUpperCase()) ?? [];
        },
    };
}

/**
 * What a pick did. Three states rather than a boolean because the two failures differ: showing what is
 * already shown is not a failure at all, and reporting it as one would put an error in front of a reader
 * who did nothing wrong.
 */
export type SetPick = "changed" | "unchanged" | "refused";

/**
 * One armour level, resolved: the files it draws and the stances those hold.
 *
 * Both, because they answer different questions. A MEMBER is a file - the unit a model is decoded from and
 * a save is written to. A STANCE is a direction band inside one, which is what the reader picks: a set
 * spreads its stances over its files by a convention of its naming family, and the same creature ships as
 * ten single-band files under one family and three packed ones under another.
 *
 * The stance list is resolved with the level rather than lazily, because it takes a whole set's cycle
 * TABLES and not its pixels: banding a character set's two dozen files costs a fraction of decoding the one
 * the reader lands on, which stays lazy below.
 */
interface ArmourLevel {
    level: number;
    actions: SchemeMember[];
    stances: SetStance[];
}

/** One loaded member: the action it stands for, and the model the editor draws and edits. */
interface OpenAction {
    action: SchemeMember;
    model: ImageDocumentModel;
}

/** What the editor has open: a band, the file it sits in, and that file's model. */
interface OpenStance extends OpenAction {
    stance: SetStance;
}

/** One member of the whole set, as an export enumerates it: which file, at which armour level. */
export interface SetMember extends OpenAction {
    resref: string;
    armour: number;
    /**
     * The eastern twin this member was composed with, where it has one. Resolved here rather than by each
     * caller reading `parts`: a write and its preview both have to name the same files, and a second
     * reading of the same shape is what lets them disagree.
     */
    east?: string;
}

/**
 * Whether a member's files are a base and its EASTERN TWIN, rather than any other multi-file composition.
 *
 * The distinction matters twice and must not drift between them: a save cuts such a member back into both
 * halves, and its facings are all eight stored rather than five with the east mirrored. A bare count says
 * neither - a quadrant member draws four files and stores no more facings than a single one does.
 */
export function isEastPair(parts: readonly string[]): boolean {
    const [base, east] = parts;
    return parts.length === 2 && base !== undefined && east === `${base}E`;
}

/** The twin such a member is written back over, or undefined for a member that is one file. */
export function eastTwinOf(parts: readonly string[]): string | undefined {
    return isEastPair(parts) ? parts[1] : undefined;
}

/**
 * How the webview addresses one stance.
 *
 * File, band AND sequence. The file alone cannot tell the rows of a six-stance `G1` apart, and the band
 * alone cannot tell apart the rows of a band the engine plays for several sequences - a dragon's stand,
 * combat stance and conjure are one clip, so keying on the band selected whichever came first and the
 * picture never changed. Opaque to the webview, which only sends it back.
 */
export function stanceKey(stance: Pick<SetStance, "resref" | "band" | "code">): string {
    const at = `${stance.resref}#${stance.band}`;
    return stance.code === undefined ? at : `${at}/${stance.code}`;
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

/** The member a stance's band lives in, or undefined where this level no longer draws that file. */
function memberOf(level: ArmourLevel, stance: SetStance): SchemeMember | undefined {
    return level.actions.find((action) => action.resref === stance.resref);
}

/** One stance opened: its band, its file's member, and that file's decoded model. */
function openStance(io: StanceIo, models: MemberModels, level: ArmourLevel, stance: SetStance): OpenStance | undefined {
    const action = memberOf(level, stance);
    if (action === undefined) return undefined;
    const model = modelFor(io, models, action);
    return model === undefined ? undefined : { stance, action, model };
}

/**
 * The first stance of `level` whose files parse, with its model.
 *
 * Not simply the first stance: the band reader answers off the cycle tables, which say a file has the
 * structure without saying every frame in it decodes - and a stance that cannot be drawn is not one to
 * open on.
 */
function firstDrawn(io: StanceIo, models: MemberModels, level: ArmourLevel): OpenStance | undefined {
    for (const stance of level.stances) {
        const open = openStance(io, models, level, stance);
        if (open !== undefined) return open;
    }
    return undefined;
}

function resolveLevel(set: AnimationSet, io: StanceIo, level: number): ArmourLevel {
    return { level, actions: setMembers(set, level, io.exists), stances: setStances(set, level, io) };
}

export class AnimationSetState {
    readonly set: AnimationSet;
    private readonly io: StanceIo;
    private readonly models: MemberModels;
    private current: ArmourLevel;
    private open: OpenStance;
    /** Resolved once at open: the archive answer costs a lookup per action per level. */
    private readonly levels: readonly number[];

    private constructor(
        set: AnimationSet,
        io: StanceIo,
        models: MemberModels,
        level: ArmourLevel,
        open: OpenStance,
        levels: readonly number[],
    ) {
        this.set = set;
        this.io = io;
        this.models = models;
        this.current = level;
        this.open = open;
        this.levels = levels;
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
     * The scheme carries the first in its own words, since only it knows what is unmodelled - and it is
     * already decided by whether a layout resolved, which is exactly the case `setMembers` names nothing for.
     */
    static refusal(set: AnimationSet, hex: string): string {
        return set.scheme.kind === "unimplemented"
            ? `Cannot show animation ${hex}: ${set.scheme.reason}.`
            : `This install ships no files for animation ${hex}.`;
    }

    static open(set: AnimationSet, io: StanceIo, armour?: number): AnimationSetState | undefined {
        // The levels this install DRAWS, not the ones the family declares: a classic archive ships no
        // plate-armoured thief, and offering the declared four gives the picker three empty rows.
        const levels = drawnArmourLevels(set, io.exists);
        const chosen = armour !== undefined && levels.includes(armour) ? armour : (levels[0] ?? firstArmour(set) ?? 1);
        const level = resolveLevel(set, io, chosen);
        const models: MemberModels = new Map();
        const first = firstDrawn(io, models, level);
        return first === undefined ? undefined : new AnimationSetState(set, io, models, level, first, levels);
    }

    /** Every armour level this install draws the set at, lowest first - what the armour picker offers. */
    get armours(): readonly number[] {
        return this.levels;
    }

    get armour(): number {
        return this.current.level;
    }

    /** Every stance this armour level draws, in the order the picker should list them. */
    get stances(): readonly SetStance[] {
        return this.current.stances;
    }

    get stance(): SetStance {
        return this.open.stance;
    }

    /** Which direction band of the open file is showing - what the stage draws. */
    get band(): number {
        return this.open.stance.band;
    }

    /** The FILE the open stance lives in: what a save writes, and what a palette is looked up against. */
    get action(): SchemeMember {
        return this.open.action;
    }

    get model(): ImageDocumentModel {
        return this.open.model;
    }

    /**
     * Show the stance `key` names - see `stanceKey`.
     *
     * Refused where this level does not name it, or where its file will not parse: the document must keep
     * a model either way, so the open stance stays and the caller reports what happened.
     */
    select(key: string): SetPick {
        if (key === stanceKey(this.open.stance)) return "unchanged";
        const stance = this.current.stances.find((candidate) => stanceKey(candidate) === key);
        if (stance === undefined) return "refused";
        const open = openStance(this.io, this.models, this.current, stance);
        if (open === undefined) return "refused";
        // "changed" is about the STANCE, not the model: two bands of one packed file share a model, so
        // moving between them changes what is drawn while the picture being edited stays the same object.
        this.open = open;
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
     * Every member of every armour level this install draws, loaded, in level then declaration order.
     *
     * The opposite population from `editedMembers`, and deliberately so: an export writes the whole
     * creature, and a character's armour levels are separate files under separate prefixes, so the level
     * the picker happens to be on is not the set. Members already open come from the cache, which is what
     * puts the reader's unsaved edits into the export rather than the archive's own bytes.
     *
     * `unreadable` names the files this install ships that would not decode. Dropping them silently would
     * write an incomplete creature with nothing on screen saying which part is missing.
     */
    allMembers(): { members: SetMember[]; unreadable: string[] } {
        const members: SetMember[] = [];
        const unreadable: string[] = [];
        for (const level of this.levels) {
            for (const action of resolveLevel(this.set, this.io, level).actions) {
                const model = modelFor(this.io, this.models, action);
                if (model === undefined) unreadable.push(action.resref);
                else {
                    const east = eastTwinOf(action.parts);
                    members.push({
                        resref: action.resref,
                        armour: level,
                        action,
                        model,
                        ...(east === undefined ? {} : { east }),
                    });
                }
            }
        }
        return { members, unreadable };
    }

    /**
     * The facings this set's files store art for, which decides what it can be converted into.
     *
     * The set's declared band width first, which is the install stating the answer. Failing that the open
     * member's own resolved layout, and there the file COUNT settles the eastern half: an eight-slot base
     * file leaves its three eastern slots for the engine to mirror, while the same member paired with its
     * `E` twin stores all eight.
     *
     * Empty where the cycles are not directions at all - an ambient, an effect, a town static. Not every
     * animation an install declares is a creature, and one that is not has nothing a creature layout could
     * be built from.
     *
     * An APPROXIMATION of the set, deliberately: it reads the open member, where a set can hold members of
     * differing shape. It decides only what the menu OFFERS; the planner still checks every action and
     * refuses with the member and slots named, so a set this lets through is not one that writes holes.
     */
    storedFacings(): readonly Facing[] {
        const declared = this.set.bandStride;
        if (declared !== undefined) return ieFacingsForStride(declared, this.set.coarseBands === true);
        switch (this.open.model.animation.meta.directionLayout) {
            case "ie9":
                // Through the scheme's own block size rather than a nine written here: "ie9 means nine" has
                // one home, and a second statement of it would drift the first time a scheme is edited.
                return ieFacingsForStride(ieBlockSize("ie9") ?? 0);
            case "ie8": {
                const all = ieFacingsForStride(IE_STRIDE);
                // The eastern twin specifically, not any second file: a quadrant member draws four and
                // stores no more facings for it.
                return isEastPair(this.open.action.parts) ? all : all.slice(0, IE_WEST_SLOTS);
            }
            default:
                return [];
        }
    }

    /**
     * The band width the open member is read at where it is drawn over another - see `overlaidStride`.
     *
     * Here rather than in `setView` because the archive handle is this object's: a caller outside it would
     * need one passed in solely to ask.
     */
    overlaidStride(): { stride: number; scheme?: IeScheme } | undefined {
        return overlaidStride(this.set, this.current.level, this.io, this.open.action);
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
            this.levels
                .flatMap((level) => resolveLevel(this.set, this.io, level).actions)
                .find((candidate) => candidate.resref === resref);
        if (action === undefined) return;
        this.models.set(resref, { action, model });
        // The open BAND is unaffected - the restore swaps the file's pixels, not which stance is showing.
        if (this.open.action.resref === resref) this.open = { ...this.open, action, model };
    }

    /**
     * Re-read this level's members from the game, dropping every cached model.
     *
     * Stays on the open stance where it still draws, since a revert should not move the picker. False -
     * keeping what is loaded - when nothing draws any more: the document must hold a model either way, and
     * a set whose files have just been removed is better shown stale than blank.
     */
    reload(): boolean {
        this.models.clear();
        const resolved = resolveLevel(this.set, this.io, this.current.level);
        const key = stanceKey(this.open.stance);
        const same = resolved.stances.find((candidate) => stanceKey(candidate) === key);
        const open =
            (same === undefined ? undefined : openStance(this.io, this.models, resolved, same)) ??
            firstDrawn(this.io, this.models, resolved);
        if (open === undefined) return false;
        this.current = resolved;
        this.open = open;
        return true;
    }

    /**
     * Show `level`'s stances, opening on the first that draws. Refused - leaving the open level alone -
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

/**
 * Where the stance's art actually lives, for the row's tooltip.
 *
 * The band is counted from one here and from zero everywhere else: this string is the one place a reader
 * sees it, and a picker whose first row says "band 0" reads as an off-by-one rather than as a convention.
 *
 * A stance drawn from more than a handful of files is COUNTED rather than listed - a tiled set composes
 * one picture from a file per grid cell per facing, and the red dragon's opening stance draws 81 of them.
 */
const TITLE_FILES = 2;

function stanceTitle(stance: SetStance): string {
    const [first, ...rest] = stance.parts;
    const files =
        stance.parts.length <= TITLE_FILES ? stance.parts.join(" + ") : `${first} and ${rest.length} more files`;
    return `${files}, band ${stance.band + 1}`;
}

/**
 * The game's own override folder, which is where a save can land beside a folder of the reader's own.
 *
 * `<game>/override` for an Infinity Engine install - the one the engine reads loose files from, and the
 * one a plain Save already writes into. Composed here rather than asked of the archive: the folder stack
 * is configurable, but this is the one every install has and the only one worth OFFERING as a destination.
 */
export function overridePathOf(gameDir: string): string {
    return `${gameDir}/override`;
}

/**
 * The set's OWN shape - what the dialog opens on, and what a save is compared against to tell a straight
 * write from a retarget.
 *
 * Exported because the host asks the same question when a save runs: the dialog decides what to show from
 * it and the provider decides what to DO from it, and a second derivation of "is this the set's own shape"
 * would let those two disagree about which path a reader is on.
 */
export function setSaveSource(state: AnimationSetState): SetView["saveOptions"]["source"] {
    const held = state.storedFacings();
    const naming = namingForLayout(state.set.layout);
    return {
        // The set's own wheel, read off what it stores rather than off what it could be written as: nine
        // stored facings are sixteen shown, which is the distinction the count alone loses. Kept for what
        // the dialog SHOWS about the source; the shape it would be written in comes from the section.
        ...(held.length === 0 ? {} : { directions: held.length > IE_STRIDE ? (16 as const) : (8 as const) }),
        storeEast: held.length === IE_STRIDE || held.length === IE_WHEEL_SLOTS,
        ...(naming === undefined ? {} : { naming }),
        // The section the set was READ under, which is what a request has to differ from to be a reshape.
        ...(state.set.section === undefined ? {} : { section: state.set.section }),
    };
}

/** What the Save As dialog may offer for this set - see `SetSaveOptionsView`. */
function saveOptionsOf(state: AnimationSetState, gameDir: string): SetView["saveOptions"] {
    // The set's OWN header first where this project has no spelling for it: an INI section is an install's
    // vocabulary, so a picker closed to the ones listed here would refuse to write a set back under the
    // header it was read from.
    const known = sectionOptions();
    const own = state.set.section;
    const offered =
        own === undefined || known.some((entry) => entry.id === own) ? known : [{ id: own, label: own }, ...known];
    // The section carries the SHAPE, so what a set can be written under is what its own facings can fill.
    const held = state.storedFacings();
    const sections = offered.map((entry) => ({ ...entry, reachable: sectionIsReachable(entry.id, held) }));
    return {
        namings: IE_NAMINGS.map((id) => ({ id, label: NAMING_LABELS[id] })),
        sections,
        source: setSaveSource(state),
        overridePath: overridePathOf(gameDir),
    };
}

/** What the editor's set controls read: the level and stance lists, and which of each is open. */
export function setView(state: AnimationSetState, gameDir: string): SetView {
    return {
        id: state.set.id,
        title: setTitle(state.set),
        armours: state.armours.map((level) => ({ level, label: armourLabel(level) })),
        armour: state.armour,
        stances: state.stances.map((stance) => ({
            key: stanceKey(stance),
            label: stance.label,
            title: stanceTitle(stance),
        })),
        stance: stanceKey(state.stance),
        band: state.band,
        saveOptions: saveOptionsOf(state, gameDir),
        ...(state.stance.reversed === true ? { reversed: true as const } : {}),
        ...(state.set.section === undefined
            ? {}
            : {
                  section: state.set.section,
                  familyLabel: sectionLabel(state.set.section),
                  familyTitle: familyDescription(state.set.section, state.set.layout),
              }),
        ...bandsOf(state),
    };
}

/**
 * The band width to send for the open member, where anything but the file itself settles it.
 *
 * The set's own declared stride first. Failing that, the member the open one is drawn OVER, if any: the
 * panel bands whatever single member is open, and an overlay's own files need not carry the structure to
 * cut on - the burrowing family's are one still per cycle, and its rose came back three facings short of
 * the body it is drawn on. Nothing here for an ordinary member, which the panel reads structurally.
 */
function bandsOf(state: AnimationSetState): Pick<SetView, "bands"> | Record<string, never> {
    if (state.set.bandStride !== undefined) {
        return { bands: declaredBands(state.set.bandStride, state.set.coarseBands) };
    }
    const overlaid = state.overlaidStride();
    return overlaid === undefined ? {} : { bands: overlaid };
}

/** A declared band width, the block scheme it implies where one covers it, and how many facings it holds. */
function declaredBands(stride: number, coarse: true | undefined): NonNullable<SetView["bands"]> {
    const scheme = schemeForStride(stride);
    return { stride, ...(scheme === undefined ? {} : { scheme }), ...(coarse === undefined ? {} : { coarse }) };
}
