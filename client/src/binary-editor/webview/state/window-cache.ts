import type { NodeId, Row } from "@bgforge/binary-editor";

interface Entry {
    rows: Row[];
    total: number;
}
const key = (parentId: NodeId | null, start: number, end: number) => `${parentId ?? ""}:${start}:${end}`;

export class WindowCache {
    private windows = new Map<string, Entry>();
    private totals = new Map<string, number>();

    get(parentId: NodeId | null, start: number, end: number): Entry | undefined {
        return this.windows.get(key(parentId, start, end));
    }

    put(parentId: NodeId | null, start: number, end: number, entry: Entry): void {
        this.windows.set(key(parentId, start, end), entry);
        this.totals.set(parentId ?? "", entry.total);
    }

    totalFor(parentId: NodeId | null): number | undefined {
        return this.totals.get(parentId ?? "");
    }

    /** Drop everything. Called on any mutation (edit/add) and on model reset (undo/redo/revert). */
    clear(): void {
        this.windows.clear();
        this.totals.clear();
    }
}
