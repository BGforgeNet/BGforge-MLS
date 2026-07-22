export type LossKind =
    | "dropped-fps"
    | "dropped-action-frame"
    | "dropped-direction"
    | "empty-direction"
    | "padded-sequence"
    | "duplicated-shared-frames"
    | "embedded-palette"
    | "palette-remapped-to-default"
    | "palette-sidecar-required";

export interface LossItem {
    kind: LossKind;
    detail: string;
}

export class LossReport {
    readonly items: LossItem[] = [];

    add(kind: LossKind, detail: string): void {
        this.items.push({ kind, detail });
    }

    get lossless(): boolean {
        return this.items.length === 0;
    }

    has(kind: LossKind): boolean {
        return this.items.some((item) => item.kind === kind);
    }
}
