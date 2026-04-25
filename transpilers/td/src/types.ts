/**
 * TD Intermediate Representation Types
 *
 * These types represent the parsed structure of a TD file before
 * emission to D format. The IR is language-agnostic and captures
 * all D constructs.
 */

// =============================================================================
// Enums
// =============================================================================

/** Top-level D construct types. */
export enum TDConstructType {
    Begin = "begin",
    Append = "append",
    ExtendTop = "extend_top",
    ExtendBottom = "extend_bottom",
    Chain = "chain",
    Interject = "interject",
    InterjectCopyTrans = "interject_copy_trans",
    InterjectCopyTrans2 = "interject_copy_trans2",
    Patch = "patch",
}

/** Text content types. */
export enum TDTextType {
    Tra = "tra",
    Tlk = "tlk",
    Literal = "literal",
    Forced = "forced",
}

/** Transition destination types. */
export enum TDTransitionType {
    Goto = "goto",
    Exit = "exit",
    Extern = "extern",
    CopyTrans = "copy_trans",
}

/** Chain epilogue types. */
export enum TDEpilogueType {
    Exit = "exit",
    End = "end",
    CopyTrans = "copy_trans",
    Transitions = "transitions",
}

/** Patch operation types. */
export enum TDPatchOp {
    AlterTrans = "alter_trans",
    AddStateTrigger = "add_state_trigger",
    AddTransTrigger = "add_trans_trigger",
    AddTransAction = "add_trans_action",
    ReplaceTransTrigger = "replace_trans_trigger",
    ReplaceTransAction = "replace_trans_action",
    ReplaceTriggerText = "replace_trigger_text",
    ReplaceActionText = "replace_action_text",
    SetWeight = "set_weight",
    ReplaceSay = "replace_say",
    ReplaceStateTrigger = "replace_state_trigger",
    ReplaceStates = "replace_states",
}

// =============================================================================
// Script-level types
// =============================================================================

/** Shared warning message template for orphan state detection.
 * Used by both detectOrphansFromOriginal() (index.ts) and TDParser.collectOrphanWarnings() (parse.ts).
 * Must stay in sync — mergeWarnings() deduplicates by exact message equality. */
export const ORPHAN_WARNING_TEMPLATE = (name: string) =>
    `Function "${name}" looks like an orphan state (not collected by any begin/append and not called as a helper)`;

/**
 * A warning emitted during parsing (e.g. orphan state functions).
 *
 * TD is the only transpiler with warnings because dialog files have strong
 * structural semantics: zero-parameter functions represent dialog states, and
 * an unused state almost always indicates a bug (missing transition, typo).
 * TSSL/TBAF lack equivalent high-signal heuristics -- unused functions there
 * are typically intentional dead code or library helpers, so warnings would
 * produce more noise than signal.
 */
export interface TDWarning {
    message: string;
    /** 1-based line number */
    line: number;
    /** 0-based column of warning start */
    columnStart: number;
    /** 0-based column of warning end */
    columnEnd: number;
}

/** A complete TD script, can contain multiple constructs */
export interface TDScript {
    sourceFile: string;
    traTag?: string;
    constructs: TDConstruct[];
    warnings?: TDWarning[];
}

/** Top-level D construct */
export type TDConstruct = TDBegin | TDAppend | TDExtend | TDChain | TDInterject | TDPatch;

/** BEGIN - new dialog file */
export interface TDBegin {
    type: TDConstructType.Begin;
    filename: string;
    nonPausing?: boolean;
    states: TDState[];
}

/** APPEND / APPEND_EARLY - add states to existing dialog */
export interface TDAppend {
    type: TDConstructType.Append;
    filename: string;
    ifFileExists?: boolean;
    /** When true, emit APPEND_EARLY instead of APPEND */
    early?: boolean;
    states: TDState[];
}

/** EXTEND_TOP / EXTEND_BOTTOM - add transitions to existing state */
export interface TDExtend {
    type: TDConstructType.ExtendTop | TDConstructType.ExtendBottom;
    filename: string;
    stateLabel: string;
    position?: number;
    transitions: TDTransition[];
}

/** CHAIN - multi-speaker conversation */
export interface TDChain {
    type: TDConstructType.Chain;
    filename: string;
    label: string;
    trigger?: string;
    weight?: number;
    action?: string;
    ifFileExists?: boolean;
    entries: TDChainEntry[];
    epilogue: TDChainEpilogue;
}

/** INTERJECT variants */
export interface TDInterject {
    type: TDConstructType.Interject | TDConstructType.InterjectCopyTrans | TDConstructType.InterjectCopyTrans2;
    filename: string;
    stateLabel: string;
    globalVariable: string;
    safe?: boolean;
    entries: TDChainEntry[];
    epilogue?: TDChainEpilogue; // Not needed for copy_trans variants
}

/** Patching operations */
interface TDPatch {
    type: TDConstructType.Patch;
    operation: TDPatchOperation;
}

// =============================================================================
// State types
// =============================================================================

/** A dialog state (IF ... END block) */
export interface TDState {
    label: string;
    trigger?: string; // State entry trigger
    weight?: number;
    say: TDSay[];
    transitions: TDTransition[];
}

/** SAY statement, can have multiple texts (multisay) */
interface TDSay {
    text: TDText;
}

/** Text content - can be tra ref, tlk ref, or literal */
export interface TDText {
    type: TDTextType;
    value: number | string;
    sound?: string;
    // For male/female variants
    male?: TDText;
    female?: TDText;
}

// =============================================================================
// Transition types
// =============================================================================

/** A transition within a state */
export interface TDTransition {
    trigger?: string; // Empty = no trigger (++)
    reply?: TDText;
    action?: string;
    next: TDTransitionNext;
    journal?: TDText;
    solvedJournal?: TDText;
    unsolvedJournal?: TDText;
    flags?: number;
}

/** Where a transition goes */
export type TDTransitionNext =
    | { type: TDTransitionType.Goto; target: string }
    | { type: TDTransitionType.Exit }
    | { type: TDTransitionType.Extern; filename: string; target: string; ifFileExists?: boolean }
    | { type: TDTransitionType.CopyTrans; filename: string; target: string; safe?: boolean; late?: boolean };

// =============================================================================
// Chain types
// =============================================================================

/** Entry in a CHAIN - speaker + text */
export interface TDChainEntry {
    speaker?: string; // undefined = same speaker continues
    trigger?: string; // IF condition for this entry
    ifFileExists?: boolean;
    texts: TDText[];
    action?: string;
}

/** How a CHAIN ends */
export type TDChainEpilogue =
    | { type: TDEpilogueType.Exit }
    | { type: TDEpilogueType.End; filename: string; target: string }
    | { type: TDEpilogueType.CopyTrans; filename: string; target: string; safe?: boolean; late?: boolean }
    | { type: TDEpilogueType.Transitions; transitions: TDTransition[] };

// =============================================================================
// Patch operation types
// =============================================================================

/** @public Used via inline import() in td/emit.ts */
export type TDPatchOperation =
    | TDAlterTrans
    | TDAddStateTrigger
    | TDAddTransTrigger
    | TDAddTransAction
    | TDReplaceTrans
    | TDReplaceText
    | TDSetWeight
    | TDReplaceSay
    | TDReplaceStateTrigger
    | TDReplaceStates;

export interface TDAlterTrans {
    op: TDPatchOp.AlterTrans;
    filename: string;
    states: (string | number)[];
    transitions: number[];
    changes: {
        trigger?: string | false;
        action?: string;
        reply?: TDText;
        // ... other fields
    };
}

export interface TDAddStateTrigger {
    op: TDPatchOp.AddStateTrigger;
    filename: string;
    states: (string | number)[];
    trigger: string;
    unless?: string;
}

export interface TDAddTransTrigger {
    op: TDPatchOp.AddTransTrigger;
    filename: string;
    states: (string | number)[];
    transitions?: number[];
    trigger: string;
    unless?: string;
}

export interface TDAddTransAction {
    op: TDPatchOp.AddTransAction;
    filename: string;
    states: (string | number)[];
    transitions: number[];
    action: string;
    unless?: string;
}

export interface TDReplaceTrans {
    op: TDPatchOp.ReplaceTransTrigger | TDPatchOp.ReplaceTransAction;
    filename: string;
    states: (string | number)[];
    transitions: number[];
    oldText: string;
    newText: string;
    unless?: string;
}

export interface TDReplaceText {
    op: TDPatchOp.ReplaceTriggerText | TDPatchOp.ReplaceActionText;
    filenames: string[];
    oldText: string;
    newText: string;
    unless?: string;
}

export interface TDSetWeight {
    op: TDPatchOp.SetWeight;
    filename: string;
    state: string;
    weight: number;
}

export interface TDReplaceSay {
    op: TDPatchOp.ReplaceSay;
    filename: string;
    state: string;
    text: TDText;
}

export interface TDReplaceStateTrigger {
    op: TDPatchOp.ReplaceStateTrigger;
    filename: string;
    states: (string | number)[];
    trigger: string;
    unless?: string;
}

export interface TDReplaceStates {
    op: TDPatchOp.ReplaceStates;
    filename: string;
    replacements: Map<number, TDState>;
}
