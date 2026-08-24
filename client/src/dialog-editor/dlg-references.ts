/**
 * Which replies lead INTO a given dialog state, across every dialog in the game.
 *
 * A DLG addresses a jump as (dialog resref, state number), so the outgoing direction is readable from the
 * file in hand - but the incoming direction is not in the file at all, and a state's number is exactly what
 * other dialogs hold. Nothing can be said about detaching a state, or drawn as an inbound edge in the tree,
 * without scanning the whole set once.
 *
 * `ready` is deliberately separate from "found nothing": an index still building and an index that has
 * looked and found no references must never render the same, or an unchecked state reads as a safe one.
 */

import { readDlg } from "@bgforge/binary";
import { resrefName } from "../../../shared/dialog-model-dlg";

/** One reply that leads somewhere: which dialog holds it, which state offers it, and its position there. */
export interface InboundRef {
    readonly dialog: string;
    readonly state: number;
    readonly transition: number;
}

/** The dialogs to scan. Kept abstract so the index is testable without a game install. */
export interface DlgSource {
    list(): string[];
    read(resref: string): Uint8Array;
}

/** How many dialogs are scanned before yielding, so a build never blocks the extension host. */
const SCAN_CHUNK = 50;

/** Hand the event loop back, so a scan of thousands of files stays a background job rather than a stall. */
function yieldToHost(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

const key = (resref: string, state: number): string => `${resref.toUpperCase()}:${state}`;

/**
 * How many other dialogs are loaded alongside the one being edited. Measured against a full Baldur's Gate II
 * install: most dialogs have no cross-file neighbour at all, about 97% have twelve or fewer, and the busiest
 * hub has 179 - a tree nobody can read and a parse nobody asked for. The bound is on the tree's usefulness,
 * not on the index, which holds the whole game either way.
 */
export const NEIGHBOUR_LIMIT = 12;

/**
 * The dialogs to load alongside `ownResref` so its conversation closes up: the ones it hands off to first,
 * since those edges are visible in the file being edited, then the ones that hand off to it. Returns what was
 * left out rather than truncating quietly - a tree missing a branch must not look like a complete one.
 */
export function neighbourDialogs(
    outgoing: Iterable<string>,
    incoming: Iterable<string>,
    ownResref: string,
): { load: string[]; omitted: number } {
    const own = resrefName(ownResref);
    const all: string[] = [];
    const seen = new Set<string>([own]);
    for (const raw of [...outgoing, ...incoming]) {
        const name = resrefName(raw);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        all.push(name);
    }
    return { load: all.slice(0, NEIGHBOUR_LIMIT), omitted: Math.max(0, all.length - NEIGHBOUR_LIMIT) };
}

export class DlgReferenceIndex {
    /** target `RESREF:state` -> the replies that lead there. */
    private targets = new Map<string, InboundRef[]>();
    /** Every edge a given dialog contributes, so re-reading one file can retract exactly its own. */
    private bySource = new Map<string, { key: string; target: string; ref: InboundRef }[]>();
    /** target dialog -> the dialogs holding a reply into it, for "what should be loaded alongside this one". */
    private byTargetDialog = new Map<string, Set<string>>();
    private built = false;

    /** False until a build has completed. An unfinished index answers `inbound` with nothing - say so. */
    get ready(): boolean {
        return this.built;
    }

    /** The replies leading into `resref` state `stateIndex`. Meaningless unless `ready`. */
    inbound(resref: string, stateIndex: number): InboundRef[] {
        return this.targets.get(key(resref, stateIndex)) ?? [];
    }

    /**
     * The other dialogs that jump into `resref`, at any state. Kept as its own map rather than derived from
     * `targets`, which is keyed per state and would have to be walked in full for every open.
     */
    inboundDialogs(resref: string): string[] {
        const name = resrefName(resref);
        return [...(this.byTargetDialog.get(name) ?? [])].filter((source) => source !== name);
    }

    /**
     * Scan every dialog. Yields between chunks so the host stays responsive, and abandons the whole build on
     * abort rather than leaving a half-scan that would look authoritative.
     */
    async build(source: DlgSource, signal?: AbortSignal): Promise<void> {
        this.targets = new Map();
        this.bySource = new Map();
        this.byTargetDialog = new Map();
        this.built = false;
        const names = source.list();
        for (const [i, name] of names.entries()) {
            if (signal?.aborted) return;
            this.ingest(name, () => source.read(name));
            // Sequential on purpose: the await IS the yield. Collecting these into a Promise.all would
            // run the whole scan without ever giving the host a turn, which is what this avoids.
            // eslint-disable-next-line no-await-in-loop
            if (i % SCAN_CHUNK === SCAN_CHUNK - 1) await yieldToHost();
        }
        if (signal?.aborted) return;
        this.built = true;
    }

    /** Re-read one dialog - after a save - replacing only the edges it contributes. */
    update(resref: string, bytes: Uint8Array): void {
        this.retract(resref);
        this.ingest(resref, () => bytes);
    }

    private retract(resref: string): void {
        const name = resref.toUpperCase();
        for (const { key: target, target: dialog, ref } of this.bySource.get(name) ?? []) {
            const list = this.targets.get(target);
            if (list) {
                const remaining = list.filter((r) => r !== ref);
                if (remaining.length === 0) this.targets.delete(target);
                else this.targets.set(target, remaining);
            }
            // Every edge this file contributes is retracted together, so removing it from each target it
            // reached is exact - no other edge of its own can still be holding the entry open.
            const sources = this.byTargetDialog.get(dialog);
            if (!sources) continue;
            sources.delete(name);
            if (sources.size === 0) this.byTargetDialog.delete(dialog);
        }
        this.bySource.delete(name);
    }

    /**
     * Record every jump one dialog makes. A file that will not parse is skipped: a game holds resources this
     * editor cannot read, and one of them must not abandon the scan of the rest.
     */
    private ingest(resref: string, read: () => Uint8Array): void {
        let dlg;
        try {
            dlg = readDlg(read());
        } catch {
            return;
        }
        const source = resref.toUpperCase();
        const own: { key: string; target: string; ref: InboundRef }[] = [];

        for (const [stateIndex, state] of dlg.states.entries()) {
            for (let i = 0; i < state.transitionCount; i++) {
                const transition = dlg.transitions[state.firstTransition + i];
                // A reply that ends the conversation still stores a state number; read without checking the
                // flag it would register as a jump to state 0 of this dialog.
                if (!transition || transition.terminatesDialog) continue;
                const target = resrefName(transition.nextDialog) || source;
                const entry = {
                    key: key(target, transition.nextState),
                    target,
                    ref: { dialog: source, state: stateIndex, transition: i },
                };
                own.push(entry);
                const list = this.targets.get(entry.key);
                if (list) list.push(entry.ref);
                else this.targets.set(entry.key, [entry.ref]);
                const sources = this.byTargetDialog.get(target) ?? new Set<string>();
                sources.add(source);
                this.byTargetDialog.set(target, sources);
            }
        }
        this.bySource.set(source, own);
    }
}
