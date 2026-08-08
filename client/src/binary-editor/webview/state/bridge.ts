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
interface PendingResourceList {
    resolve: (v: readonly string[]) => void;
    reject: (e: Error) => void;
}
interface PendingThumbnail {
    resolve: (v: string | undefined) => void;
    reject: (e: Error) => void;
}

export class Bridge {
    private readonly post: (m: WebviewToHost) => void;
    private nextId = 1;
    private pending = new Map<number, Pending>();
    private pendingSpellbook = new Map<number, PendingSpellbook>();
    private pendingEffectTree = new Map<number, PendingEffectTree>();
    private pendingResourceList = new Map<number, PendingResourceList>();
    private resourceLists = new Map<string, Promise<readonly string[]>>();
    private pendingThumbnail = new Map<number, PendingThumbnail>();
    private thumbnails = new Map<string, Promise<string | undefined>>();

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

    /**
     * Fetch every resref of one type the open game holds - the suggestion set behind a resref field's picker.
     *
     * Cached per extension, unlike the other queries, because these lists are large (BAM alone is ~12300 entries
     * in a plain BG:EE) and are not derived from the record, so a mutation cannot stale them; a resource
     * installed while the panel is open is not picked up until it is reopened. A failed request drops out of the
     * cache so a later open retries rather than replaying the rejection.
     */
    requestResourceList(ext: string): Promise<readonly string[]> {
        const cached = this.resourceLists.get(ext);
        if (cached) return cached;
        const requestId = this.nextId++;
        this.post({ type: "requestResourceList", requestId, ext });
        const promise = new Promise<readonly string[]>((resolve, reject) => {
            this.pendingResourceList.set(requestId, { resolve, reject });
        });
        this.resourceLists.set(ext, promise);
        void promise.catch(() => this.resourceLists.delete(ext));
        return promise;
    }

    /**
     * Fetch a `data:` URI for one resource's picture, or undefined when it has none.
     *
     * Cached per resource for the same reason the lists are, plus one of its own: several rows of a record
     * commonly name the SAME icon (an item's inventory and description icons, a spell's book and memorised
     * icons), and each is a decode host-side. A rejection drops out so a later render retries.
     *
     * Keyed case-insensitively, since two rows can spell one resref differently. Carries the same accepted
     * staleness as the lists: a picture REPLACED in `override/` while this panel is open (the animation editor
     * can do that) keeps showing the old art until the record is reopened. Editing the field is unaffected -
     * a new value is a new key.
     */
    requestThumbnail(resref: string, ext: string): Promise<string | undefined> {
        const key = `${ext.toLowerCase()}:${resref.toLowerCase()}`;
        const cached = this.thumbnails.get(key);
        if (cached) return cached;
        const requestId = this.nextId++;
        this.post({ type: "requestThumbnail", requestId, resref, ext });
        const promise = new Promise<string | undefined>((resolve, reject) => {
            this.pendingThumbnail.set(requestId, { resolve, reject });
        });
        this.thumbnails.set(key, promise);
        void promise.catch(() => this.thumbnails.delete(key));
        return promise;
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

    openResource(resref: string, ext: string): void {
        this.post({ type: "openResource", resref, ext });
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
        if (message.type === "resourceList") {
            const p = this.pendingResourceList.get(message.requestId);
            if (p) {
                this.pendingResourceList.delete(message.requestId);
                p.resolve(message.resrefs);
                return true;
            }
        }
        if (message.type === "thumbnail") {
            const p = this.pendingThumbnail.get(message.requestId);
            if (p) {
                this.pendingThumbnail.delete(message.requestId);
                p.resolve(message.dataUri);
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
                const pr = this.pendingResourceList.get(message.requestId);
                if (pr) {
                    this.pendingResourceList.delete(message.requestId);
                    pr.reject(new Error(message.message));
                    return true;
                }
                const pt = this.pendingThumbnail.get(message.requestId);
                if (pt) {
                    this.pendingThumbnail.delete(message.requestId);
                    pt.reject(new Error(message.message));
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
