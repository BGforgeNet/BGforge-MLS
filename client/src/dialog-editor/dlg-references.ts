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

export class DlgReferenceIndex {
    /** target `RESREF:state` -> the replies that lead there. */
    private targets = new Map<string, InboundRef[]>();
    /** Every edge a given dialog contributes, so re-reading one file can retract exactly its own. */
    private bySource = new Map<string, { key: string; ref: InboundRef }[]>();
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
     * Scan every dialog. Yields between chunks so the host stays responsive, and abandons the whole build on
     * abort rather than leaving a half-scan that would look authoritative.
     */
    async build(source: DlgSource, signal?: AbortSignal): Promise<void> {
        this.targets = new Map();
        this.bySource = new Map();
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
        for (const { key: target, ref } of this.bySource.get(name) ?? []) {
            const list = this.targets.get(target);
            if (!list) continue;
            const remaining = list.filter((r) => r !== ref);
            if (remaining.length === 0) this.targets.delete(target);
            else this.targets.set(target, remaining);
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
        const own: { key: string; ref: InboundRef }[] = [];

        for (const [stateIndex, state] of dlg.states.entries()) {
            for (let i = 0; i < state.transitionCount; i++) {
                const transition = dlg.transitions[state.firstTransition + i];
                // A reply that ends the conversation still stores a state number; read without checking the
                // flag it would register as a jump to state 0 of this dialog.
                if (!transition || transition.terminatesDialog) continue;
                const target = resrefName(transition.nextDialog) || source;
                const entry = {
                    key: key(target, transition.nextState),
                    ref: { dialog: source, state: stateIndex, transition: i },
                };
                own.push(entry);
                const list = this.targets.get(entry.key);
                if (list) list.push(entry.ref);
                else this.targets.set(entry.key, [entry.ref]);
            }
        }
        this.bySource.set(source, own);
    }
}
