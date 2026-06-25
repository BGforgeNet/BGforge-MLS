/**
 * Format-neutral dialog model (IR).
 *
 * The dialog editor renders and edits this model; format-specific vocabulary
 * (WeiDU D `CHAIN`/`EXTERN`, Fallout SSL `NOption`/`Reply`) lives only in the
 * adapters that map a parser's output into it. See
 * `docs/superpowers/specs/2026-06-18-dialog-editor-design.md`.
 */

import type {
    DDialogData,
    DDialogState,
    DDialogTarget,
    SSLDialogData,
    SSLDialogNode,
    SSLDialogOptionType,
} from "./dialog-types";

export type DialogFormat = "weidu-d" | "fallout-ssl";

export interface DialogModel {
    format: DialogFormat;
    /** Whether this format's adapter can serialize edits back (D yes, SSL view-only in v1). */
    editable: boolean;
    roots: DialogRoot[];
    /** Resolved message strings keyed by id; populated downstream, not by the adapter. */
    messages?: Record<string, string>;
}

export type DialogRootKind = "dialog" | "patch";

export interface DialogRoot {
    id: string;
    label: string;
    kind: DialogRootKind;
    states: DialogState[];
}

export interface DialogState {
    id: string;
    speaker?: string;
    /** NPC line - resolved text, or a message ref (`@N` / numeric id) pending inlining. */
    text: string;
    trigger?: string;
    weight?: number;
    choices: DialogChoice[];
    /**
     * Byte range of the corresponding state node in the original source text.
     * Set by the WeiDU D adapter; absent on synthetic states (e.g. CHAIN-flattened)
     * and on non-D formats. Edits (including id rename) must NOT modify this field -
     * it is the stable key that maps an edited state back to its original text span.
     */
    sourceRange?: { start: number; end: number };
    /**
     * Byte ranges of the SAY value node and trigger node within the source, for per-field
     * surgical write-back (splice only the changed field). Set by the WeiDU D adapter;
     * absent on synthetic/derived states and non-D formats. Like `sourceRange`, edits must
     * not modify these - they key an edited field back to its original span.
     */
    sayRange?: { start: number; end: number };
    triggerRange?: { start: number; end: number };
    /**
     * Set when this state was expanded from a higher-level construct (WeiDU CHAIN /
     * INTERJECT / EXTEND, etc.) rather than authored as a standalone, independently
     * addressable state. Names the construct, for display. A derived state has no
     * `sourceRange`, so the editor renders it read-only and labels it by speaker/line
     * rather than its synthesized id - there is no source span to write an edit back to.
     */
    derivedFrom?: string;
}

export type DialogReaction = "neutral" | "good" | "bad";

export interface DialogChoice {
    id: string;
    /** Player reply text or message ref; absent for a direct (call/goto) transition. */
    text?: string;
    condition?: string;
    action?: string;
    target: DialogTarget;
    reaction?: DialogReaction;
    /** SSL skill/IQ gate level, when present. */
    skill?: number;
    /**
     * Byte range of this transition's node in the original source. Set by the WeiDU D
     * adapter; used by the per-field surgical edit to splice just this transition.
     */
    sourceRange?: { start: number; end: number };
}

export type DialogTarget =
    | { kind: "state"; stateId: string }
    | { kind: "external"; label: string; resolved: boolean }
    | { kind: "exit" };

// --- Display helpers (used by the webview renderer) ------------------------

/**
 * Resolve `@N` translation-string refs to their text for display. The raw `@N`
 * is kept on the model (it is the authored value and the binding the editor
 * writes back to the `.tra`); resolution happens only at render time. An
 * unresolved ref is left as `@N` so a missing string is visible, not blank.
 */
export function resolveText(text: string | undefined, messages?: Record<string, string>): string {
    if (!text) return text ?? "";
    if (!messages) return text;
    return text.replaceAll(/@(\d+)/g, (whole, n: string) => messages[n] ?? whole);
}

/** Human-readable transition target for the inspector and card rows. */
export function targetLabel(t: DialogTarget): string {
    switch (t.kind) {
        case "state":
            return t.stateId;
        case "exit":
            return "EXIT";
        case "external":
            return t.label;
    }
}

// --- WeiDU D adapter -------------------------------------------------------

function targetFromD(t: DDialogTarget): DialogTarget {
    switch (t.kind) {
        case "goto":
            return { kind: "state", stateId: t.label };
        case "exit":
            return { kind: "exit" };
        case "extern":
            // Cross-file target. `%var%` filenames are unresolvable in a single file.
            return { kind: "external", label: `${t.file}:${t.label}`, resolved: !t.file.includes("%") };
        case "copy_trans":
            return { kind: "external", label: `COPY_TRANS ${t.file}:${t.label}`, resolved: false };
    }
}

function stateFromD(s: DDialogState): DialogState {
    return {
        id: s.label,
        speaker: s.speaker,
        text: s.sayText,
        trigger: s.trigger,
        weight: s.weight,
        choices: s.transitions.map((tr, i) => ({
            id: `${s.label}#${i}`,
            text: tr.replyText,
            condition: tr.trigger,
            action: tr.action,
            target: targetFromD(tr.target),
            sourceRange: tr.range,
        })),
        sourceRange: s.range,
        sayRange: s.sayRange,
        triggerRange: s.triggerRange,
        derivedFrom: s.derivedFrom,
    };
}

export function modelFromD(data: DDialogData): DialogModel {
    // Structural blocks (begin/append/chain/extend/interject) author content;
    // modify/replace blocks patch external dialogs and render as patch roots.
    // States are grouped into roots by owning dialog file (below). TODO(phase-2+):
    // states without a block label all fall to one default-file root, so a file mixing
    // begin blocks for several different dialog files still lumps those together.
    const patchRoots: DialogRoot[] = data.blocks
        .filter((b) => b.kind === "modify" || b.kind === "replace")
        .map((b, i) => ({
            id: `patch#${i}`,
            label: b.actionName ? `${b.actionName} ${b.file}` : `PATCH ${b.file}`,
            kind: "patch" as const,
            states: [],
        }));

    // Group states under their owning dialog file so a file that appends to several
    // dialogs (or multiple chains/interjects targeting the same dialog) renders one
    // root per real dialog rather than lumping everything under the first block.
    // The parser tags each state with `blockFile` (the owning dialog, distinct from
    // the per-line CHAIN speaker); fall back to the first begin/append file only for
    // states a parser path left untagged.
    const defaultFile = data.blocks.find((b) => b.kind === "begin" || b.kind === "append")?.file ?? "dialog";
    const stateFile = (s: DDialogState): string => s.blockFile ?? defaultFile;

    const byFile = new Map<string, DialogState[]>();
    for (const s of data.states) {
        const file = stateFile(s);
        const arr = byFile.get(file) ?? byFile.set(file, []).get(file)!;
        arr.push(stateFromD(s));
    }
    const dialogRoots: DialogRoot[] = [...byFile].map(([file, states]) => ({
        id: `dialog:${file}`,
        label: file,
        kind: "dialog" as const,
        states,
    }));

    return {
        format: "weidu-d",
        editable: true,
        roots: [...dialogRoots, ...patchRoots],
        messages: data.messages,
    };
}

// --- Fallout SSL adapter (view-only) ---------------------------------------

const REACTION_BY_PREFIX: Record<string, DialogReaction> = { N: "neutral", G: "good", B: "bad" };

function reactionFromType(type: SSLDialogOptionType): DialogReaction | undefined {
    return REACTION_BY_PREFIX[type.charAt(0)];
}

function stateFromSSL(node: SSLDialogNode): DialogState {
    const choices: DialogChoice[] = [];

    node.options.forEach((opt, i) => {
        choices.push({
            id: `${node.name}#opt${i}`,
            text: String(opt.msgId),
            condition: opt.conditional,
            // A message option (empty target) ends the conversation; an option target is a node.
            target: opt.target ? { kind: "state", stateId: opt.target } : { kind: "exit" },
            reaction: reactionFromType(opt.type),
            skill: opt.skill,
        });
    });

    node.callTargets.forEach((t, i) => {
        choices.push({
            id: `${node.name}#call${i}`,
            target: { kind: "state", stateId: t },
        });
    });

    // A node can hold several (conditional) Reply lines; show the first as the line,
    // carrying its conditional. TODO(phase-5): surface alternate conditional lines.
    const firstReply = node.replies[0];
    return {
        id: node.name,
        text: firstReply ? String(firstReply.msgId) : "",
        trigger: firstReply?.conditional,
        choices,
    };
}

export function modelFromSSL(data: SSLDialogData): DialogModel {
    return {
        format: "fallout-ssl",
        editable: false,
        roots:
            data.nodes.length > 0
                ? [{ id: "dialog", label: "dialog", kind: "dialog", states: data.nodes.map(stateFromSSL) }]
                : [],
        messages: data.messages,
    };
}
