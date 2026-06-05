export interface SectionCaps {
    canAdd: boolean;
    canModify: boolean;
}

export interface RowActions {
    insert: boolean;
    duplicate: boolean;
    up: boolean;
    down: boolean;
    remove: boolean;
}

/** Which structure-op buttons are enabled for the entry at `index` of `total`, given the section capabilities. */
export function rowActions(index: number, total: number, caps: SectionCaps): RowActions {
    if (!caps.canModify) return { insert: false, duplicate: false, up: false, down: false, remove: false };
    return { insert: true, duplicate: true, up: index > 0, down: index < total - 1, remove: true };
}
