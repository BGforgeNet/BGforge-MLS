export interface SectionCaps {
    canAdd: boolean;
    canModify: boolean;
    /** When set, each entry offers an owner-scoped "add a `childAddSection` entry to this entry" action. */
    childAddSection?: string;
}

export interface RowActions {
    insert: boolean;
    duplicate: boolean;
    up: boolean;
    down: boolean;
    remove: boolean;
    /** The child section to add to this entry (owner-scoped add), or undefined when the section declares none. */
    childAdd: string | undefined;
}

/** Which structure-op buttons are enabled for the entry at `index` of `total`, given the section capabilities. */
export function rowActions(index: number, total: number, caps: SectionCaps): RowActions {
    if (!caps.canModify)
        return { insert: false, duplicate: false, up: false, down: false, remove: false, childAdd: undefined };
    return {
        insert: true,
        duplicate: true,
        up: index > 0,
        down: index < total - 1,
        remove: true,
        childAdd: caps.childAddSection,
    };
}
