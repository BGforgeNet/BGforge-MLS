/**
 * Core TD (TypeScript to D) runtime API declarations.
 * This is the transpiler API — functions that map to WeiDU D constructs.
 * Engine-specific functions (triggers, actions, constants) are separate
 * and generated per-project from server/data/*.yml.
 *
 * JSDoc sourced from weidu-d-base.yml (WeiDU documentation).
 * Copied to server/out/ during build (build-base-server.sh).
 * Injected into tsserver by the TD TypeScript plugin (plugins/td-plugin/src/index.ts).
 */

// --- IElib sync surface start ---
// These types must be structurally compatible with BGforge IElib.
// Both projects define them independently; keep shapes and brand strings identical.

/**
 * String reference (TLK index).
 *
 * Branded to prevent accidentally passing a plain number where a text
 * reference is expected.
 */
type StrRef = number & { __brand: "StrRef" };

/** Branded type for engine actions. Engine action functions must return this type. */
interface Action {
    readonly __brand: "Action";
}

// --- IElib sync surface end ---

// ---------------------------------------------------------------------------
// State-level functions (called inside state functions)
// ---------------------------------------------------------------------------

/**
 * Say text in current state.
 * Variadic: `say(t1, t2, t3)` emits multisay (`SAY text = text = text`).
 * Two-arg form: `say(dialog, text)` for cross-dialog say (chain speaker switch).
 */
declare function say(...text: StrRef[]): void;
declare function say(dialog: string, text: StrRef): void;

/**
 * Copy all transitions from the given state in the given dialog file.
 * This copying takes place before all other D Actions.
 * If `safe` is true, COPY_TRANS will not warn about potentially unsafe uses.
 * @see copyTransLate for late-binding variant
 */
declare function copyTrans(dialog: string, stateRef: string | number, options?: { safe?: boolean }): void;

/**
 * Set state weight for priority ordering.
 * Lower weights are evaluated first. Should only be used to patch existing dialogues.
 */
declare function weight(n: number): void;

// ---------------------------------------------------------------------------
// Transition builder - reply(text).action(...).goTo(target)
// ---------------------------------------------------------------------------

/** Shared terminal and modifier methods for transition builders. */
interface TransitionBuilder<Self> {
    /** Add text to the PC's journal if this transition is taken. */
    journal(text: StrRef): Self;
    /** Add text to the "solved" section of the PC's journal. */
    solvedJournal(text: StrRef): Self;
    /** Add text to the "unsolved" section of the PC's journal. */
    unsolvedJournal(text: StrRef): Self;
    /** Set transition feature flags directly using the binary DLG format. */
    flags(n: number): Self;
    /** Continue dialogue at the given state label in the same DLG file. */
    goTo(target: string | number | Function): void;
    /** End the conversation. */
    exit(): void;
    /** Continue dialogue at the given state in another DLG file. */
    extern(dialog: string, state: string | number, options?: { ifFileExists?: boolean }): void;
    /** Copy transitions from the given state, resolved after all other D Actions. */
    copyTransLate(dialog: string, state: string | number, options?: { safe?: boolean }): void;
}

/** After reply(): can chain .action(), .journal(), or terminate. */
interface AfterReply extends TransitionBuilder<AfterReply> {
    /** Execute engine actions if this transition is taken. */
    action(...actions: Action[]): AfterAction;
}

/** After action(): can chain .journal() or terminate. */
interface AfterAction extends TransitionBuilder<AfterAction> {}

/**
 * If this transition is taken, the PC says the reply text.
 * Returns a builder for chaining `.action()`, `.journal()`, and terminal (`.goTo()`, `.exit()`, `.extern()`).
 */
declare function reply(text: StrRef): AfterReply;

/**
 * Execute engine actions if this transition is taken.
 * Returns a builder for chaining `.journal()` and terminal (`.goTo()`, `.exit()`, `.extern()`).
 */
declare function action(...actions: Action[]): AfterAction;

/** Continue dialogue at the given state label in the same DLG file. Synonym for GOTO. */
declare function goTo(target: string | number | Function): void;

/** End the conversation. */
declare function exit(): void;

/**
 * Continue dialogue at the given state in another DLG file.
 * If `ifFileExists` is true, the transition is skipped if the file doesn't exist.
 */
declare function extern(dialog: string, state: string | number, options?: { ifFileExists?: boolean }): void;

/**
 * Copy transitions from the given state, resolved after all other D Actions.
 * Same as COPY_TRANS but late-binding.
 * If `safe` is true, will not warn about potentially unsafe uses.
 */
declare function copyTransLate(dialog: string, state: string | number, options?: { safe?: boolean }): void;

/** Set transition feature flags directly using the binary DLG format. */
declare function flags(value: number): void;

/** Add text to the PC's journal if this transition is taken. */
declare function journal(text: StrRef): void;

/** Add text to the "solved" section of the PC's journal. */
declare function solvedJournal(text: StrRef): void;

/** Add text to the "unsolved" section of the PC's journal. */
declare function unsolvedJournal(text: StrRef): void;

// ---------------------------------------------------------------------------
// Dialog operations - BEGIN, APPEND, EXTEND
// ---------------------------------------------------------------------------

/**
 * Create an inline state with the given label and body.
 * Use inside begin(), append(), appendEarly() argument lists.
 * @example begin("DLG", [state("greeting", () => { say(tra(1)); exit(); })]);
 */
declare function state(label: string, body: () => void): Function;

/**
 * Create a new DLG file from scratch. Any existing DLG file with the same name
 * will be overwritten. The new DLG file contains exactly the states in the list.
 */
declare function begin(dialog: string, states: (Function | string)[]): void;
declare function begin(dialog: string, ...states: Function[]): void;

/**
 * Add states to the end of an already-existing dialogue file.
 */
declare function append(dialog: string, states: Function[]): void;
declare function append(dialog: string, ...states: Function[]): void;

/**
 * Like `append`, but the states are added early in the compilation timeline
 * (just after BEGIN is processed). They can be targets for INTERJECT_COPY_TRANS.
 */
declare function appendEarly(dialog: string, ...states: Function[]): void;

/**
 * Load the given dialog and replace the state at the given numeric index
 * with the new state described by the body function.
 */
declare function replaceState(dialog: string, state: number, body: () => void): void;

/**
 * Add transitions to the top of the transition list for the specified state.
 */
declare function extendTop(dialog: string, state: string | number | Function, callback: () => void): void;

/**
 * Add transitions to the bottom of the transition list for the specified state.
 */
declare function extendBottom(dialog: string, state: string | number | Function, callback: () => void): void;
declare function extendBottom(
    dialog: string,
    state: string | number | Function,
    options: { position?: number },
    callback: () => void,
): void;

// ---------------------------------------------------------------------------
// Chain - linear multi-speaker conversations
// ---------------------------------------------------------------------------

/**
 * Create a long conversation in which the PC can say nothing.
 * Useful when NPCs talk among themselves. CHAIN only appends to existing
 * dialogues; it cannot create a new DLG.
 */
declare function chain(callback: Function): void;
declare function chain(entryTrigger: boolean, callback: Function): void;
declare function chain(dialog: string, label: string, body: () => void): void;
declare function chain(entryTrigger: boolean, dialog: string, label: string, body: () => void): void;

/** Switch speaker in a chain body. Subsequent `say()` calls use this speaker. */
declare function from(speaker: string): void;

/** Conditional speaker switch. The speaker's lines are only included if the condition is true. */
declare function fromWhen(speaker: string, condition: boolean): void;

// ---------------------------------------------------------------------------
// Interject operations
// ---------------------------------------------------------------------------

/**
 * Like CHAIN, but all chain text is guarded by `Global(globalVar, "GLOBAL", 0)`
 * and accompanied by `SetGlobal(globalVar, "GLOBAL", 1)`, ensuring
 * the interjection is only seen once per game.
 */
declare function interject(
    entryDialog: string,
    entryState: string,
    globalVar: string,
    callback: Function,
    exitDialog?: string,
    exitState?: string,
): void;

/**
 * Like `interject`, but at the end of the chain text, copies all transitions
 * from the entry state instead of using an explicit exit.
 * Convenient for quick interjections that don't change the conversation flow.
 */
declare function interjectCopyTrans(
    entryDialog: string,
    entryState: string,
    globalVar: string,
    callback: Function,
    exitDialog?: string,
    exitState?: string,
): void;

/**
 * Like `interjectCopyTrans`, but actions in the entry state's transitions
 * are preserved with the original speaker (not transferred to the new speaker).
 */
declare function interjectCopyTrans2(
    entryDialog: string,
    entryState: string,
    globalVar: string,
    callback: Function,
): void;

/**
 * Like `interjectCopyTrans`, but all states in the chain text get a link
 * in the entry state, rather than only the first one.
 */
declare function interjectCopyTrans3(
    entryDialog: string,
    entryState: string,
    globalVar: string,
    callback: Function,
): void;

/**
 * Combination of `interjectCopyTrans2` (action handling) and
 * `interjectCopyTrans3` (extended state creation rules).
 */
declare function interjectCopyTrans4(
    entryDialog: string,
    entryState: string,
    globalVar: string,
    callback: Function,
): void;

// ---------------------------------------------------------------------------
// Patch operations
// ---------------------------------------------------------------------------

/**
 * Fine-grained altering of transitions in existing dialogue states.
 */
declare function alterTrans(
    dialog: string,
    states: (string | number)[],
    trans: number[],
    options: { trigger?: boolean; action?: Action; reply?: StrRef },
): void;

/**
 * Add a trigger string to all specified states.
 * Useful for adding extra conditions to existing dialogue states.
 */
declare function addStateTrigger(dialog: string, state: string | number | (string | number)[], trigger: boolean): void;

/**
 * Add a trigger string to transitions in specified states.
 * Often used with `extendBottom` to create new branches: add the negation
 * of a predicate to existing transitions, then add a transition with that predicate.
 */
declare function addTransTrigger(
    dialog: string,
    states: (string | number)[],
    trigger: boolean,
    options?: { trans?: number[] },
): void;

/**
 * Add an action string to transitions in specified states.
 * The action is prepended to any existing action text.
 */
declare function addTransAction(dialog: string, states: (string | number)[], trans: number[], action: Action): void;

/**
 * Replace all instances of `from` text with `to` text in the trigger strings
 * of transitions in specified states.
 */
declare function replaceTransTrigger(
    dialog: string,
    states: (string | number | Function)[],
    trans: number[],
    from: string,
    to: string,
): void;

/**
 * Replace all instances of `from` text with `to` text in the action strings
 * of transitions in specified states.
 */
declare function replaceTransAction(
    dialog: string,
    states: (string | number | Function)[],
    trans: number[],
    from: string,
    to: string,
): void;

/**
 * Destructively replace every occurrence of `from` (may be a regexp) in all
 * trigger strings of the given dialog file(s).
 * Should only be used to patch or workaround existing dialogues.
 */
declare function replaceTriggerText(dialog: string | string[], from: string, to: string): void;

/**
 * Destructively replace every occurrence of `from` (may be a regexp) in all
 * action strings of the given dialog files.
 * Should only be used to patch or workaround existing dialogues.
 */
declare function replaceActionText(dialogs: string[], from: string, to: string): void;

/**
 * Destructively change the WEIGHT of the given state.
 * Should only be used to patch or workaround existing dialogues.
 */
declare function setWeight(dialog: string, state: string | number, weight: number): void;

/**
 * Destructively change the SAY text of the given state.
 * Should only be used to patch or workaround existing dialogues.
 */
declare function replaceSay(dialog: string, state: string | number, text: StrRef): void;

/**
 * Destructively set the trigger string of the specified states.
 * Should only be used to patch or workaround existing dialogues.
 */
declare function replaceStateTrigger(dialog: string, states: (string | number)[], trigger: boolean): void;

/**
 * Load the given dialog and replace states by numeric index.
 * A new state with key X replaces old state number X.
 */
declare function replace(dialog: string, states: Record<number, () => void>): void;

// ---------------------------------------------------------------------------
// Text helpers: tra(), tlk(), obj() are declared in ielib.
// ---------------------------------------------------------------------------
