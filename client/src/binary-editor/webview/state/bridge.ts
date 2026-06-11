import type { NodeId, Row, SpellbookEditOp, SpellbookView, StructureOpRequest } from "@bgforge/binary-editor";
import type { HostToWebview, WebviewToHost } from "../messages";
import { WindowCache } from "./window-cache";

interface Window {
    rows: Row[];
    total: number;
}
interface Pending {
    parentId: NodeId | null;
    start: number;
    end: number;
    resolve: (v: Window) => void;
    reject: (e: Error) => void;
}
interface PendingSpellbook {
    resolve: (v: SpellbookView) => void;
    reject: (e: Error) => void;
}

export class Bridge {
    private readonly post: (m: WebviewToHost) => void;
    private nextId = 1;
    private pending = new Map<number, Pending>();
    private pendingSpellbook = new Map<number, PendingSpellbook>();
    private cache = new WindowCache();

    constructor(post: (m: WebviewToHost) => void) {
        this.post = post;
    }

    requestChildren(nodeId: NodeId | null, start: number, end: number): Promise<Window> {
        const hit = this.cache.get(nodeId, start, end);
        if (hit) return Promise.resolve(hit);
        const requestId = this.nextId++;
        this.post({ type: "requestChildren", requestId, nodeId, start, end });
        return new Promise((resolve, reject) => {
            this.pending.set(requestId, { parentId: nodeId, start, end, resolve, reject });
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

    /** Clear cached windows after a mutation (edit/add) or model reset (undo/redo/revert). */
    invalidate(): void {
        this.cache.clear();
    }

    /** Returns true if the message resolved a pending query (caller skips other handling). */
    handle(message: HostToWebview): boolean {
        if (message.type === "children") {
            const p = this.pending.get(message.requestId);
            if (p) {
                this.pending.delete(message.requestId);
                const win = { rows: message.rows, total: message.total };
                this.cache.put(p.parentId, p.start, p.end, win);
                p.resolve(win);
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
        if (message.type === "error" && message.requestId !== undefined) {
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
        }
        return false;
    }
}
