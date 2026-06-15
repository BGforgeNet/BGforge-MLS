import type {
    EffectTreeView,
    NodeId,
    Row,
    SpellbookEditOp,
    SpellbookView,
    StructureOpRequest,
} from "@bgforge/binary-editor";
import type { HostToWebview, WebviewToHost } from "../messages";

interface Window {
    rows: Row[];
    total: number;
}
interface Pending {
    resolve: (v: Window) => void;
    reject: (e: Error) => void;
}
interface PendingSpellbook {
    resolve: (v: SpellbookView) => void;
    reject: (e: Error) => void;
}
interface PendingEffectTree {
    resolve: (v: EffectTreeView) => void;
    reject: (e: Error) => void;
}

export class Bridge {
    private readonly post: (m: WebviewToHost) => void;
    private nextId = 1;
    private pending = new Map<number, Pending>();
    private pendingSpellbook = new Map<number, PendingSpellbook>();
    private pendingEffectTree = new Map<number, PendingEffectTree>();

    /** Called with an error message that matches no pending request - an edit/structureOp/spellbookEdit failure
     *  (which carries no requestId) or a stale requestId. Set by the view so the failure surfaces to the user
     *  instead of being dropped silently. */
    onUnhandledError?: (message: string) => void;

    constructor(post: (m: WebviewToHost) => void) {
        this.post = post;
    }

    /** Fetch a window of child rows. Not cached - re-fetched on every call so a request after a mutation
     *  reflects current state (components re-request on version change). */
    requestChildren(nodeId: NodeId | null, start: number, end: number): Promise<Window> {
        const requestId = this.nextId++;
        this.post({ type: "requestChildren", requestId, nodeId, start, end });
        return new Promise((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
        });
    }

    /** Fetch the joined spellbook view. Not cached - it is re-derived from the model on every call so a fresh
     *  request after a mutation always reflects current state (the component re-requests on version change). */
    requestSpellbook(): Promise<SpellbookView> {
        const requestId = this.nextId++;
        this.post({ type: "requestSpellbook", requestId });
        return new Promise((resolve, reject) => {
            this.pendingSpellbook.set(requestId, { resolve, reject });
        });
    }

    /** Fetch the ITM/SPL abilities+effects tree view. Not cached - re-derived from the model each call so a
     *  request after a mutation reflects current state (the block re-requests on version change). */
    requestEffectTree(): Promise<EffectTreeView> {
        const requestId = this.nextId++;
        this.post({ type: "requestEffectTree", requestId });
        return new Promise((resolve, reject) => {
            this.pendingEffectTree.set(requestId, { resolve, reject });
        });
    }

    editField(nodeId: NodeId, value: number | string): void {
        this.post({ type: "editField", nodeId, value });
    }
    structureOp(op: StructureOpRequest): void {
        this.post({ type: "structureOp", op });
    }
    spellbookEdit(op: SpellbookEditOp): void {
        this.post({ type: "spellbookEdit", op });
    }
    dumpJson(): void {
        this.post({ type: "dumpJson" });
    }
    loadJson(): void {
        this.post({ type: "loadJson" });
    }

    /** Returns true if the message resolved a pending query (caller skips other handling). */
    handle(message: HostToWebview): boolean {
        if (message.type === "children") {
            const p = this.pending.get(message.requestId);
            if (p) {
                this.pending.delete(message.requestId);
                p.resolve({ rows: message.rows, total: message.total });
                return true;
            }
        }
        if (message.type === "spellbook") {
            const p = this.pendingSpellbook.get(message.requestId);
            if (p) {
                this.pendingSpellbook.delete(message.requestId);
                p.resolve(message.view);
                return true;
            }
        }
        if (message.type === "effectTree") {
            const p = this.pendingEffectTree.get(message.requestId);
            if (p) {
                this.pendingEffectTree.delete(message.requestId);
                p.resolve(message.view);
                return true;
            }
        }
        if (message.type === "error") {
            if (message.requestId !== undefined) {
                const p = this.pending.get(message.requestId);
                if (p) {
                    this.pending.delete(message.requestId);
                    p.reject(new Error(message.message));
                    return true;
                }
                const ps = this.pendingSpellbook.get(message.requestId);
                if (ps) {
                    this.pendingSpellbook.delete(message.requestId);
                    ps.reject(new Error(message.message));
                    return true;
                }
                const pe = this.pendingEffectTree.get(message.requestId);
                if (pe) {
                    this.pendingEffectTree.delete(message.requestId);
                    pe.reject(new Error(message.message));
                    return true;
                }
            }
            // No requestId (an edit/structureOp/spellbookEdit failure) or a requestId matching no live request:
            // there is no promise to reject, so surface it instead of dropping it silently.
            this.onUnhandledError?.(message.message);
            return true;
        }
        return false;
    }
}
