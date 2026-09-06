/**
 * How an animation's own vocabulary is spelled for a reader.
 *
 * One home for it, because several surfaces show the same values: the set pickers in the animation editor
 * and the conversion notes. The tables spell them for a parser - an armour LEVEL, an action struct - and
 * neither is what a control should say.
 */
import { type Action, characterMiscBlock } from "./animation-schemes/character";

export const ARMOUR_LABELS: Record<number, string> = {
    1: "None",
    2: "Leather",
    3: "Robe",
    4: "Plate",
};

export function armourLabel(level: number): string {
    return ARMOUR_LABELS[level] ?? `Level ${level}`;
}

export function actionLabel(action: Action): string {
    switch (action.kind) {
        case "attack":
            return `Attack ${action.detail}`;
        case "cast":
            return "Cast";
        case "misc":
            // A misc file's digit is a position in the band skeleton its family shares, so the control says
            // what that block depicts rather than repeating the number already in the filename. The block's
            // own label, because these labels are KEYS - the view sends the string back and lists options by
            // it - and two files that merely share a meaning would collide under a name built from the term.
            // The family's code space is open, so one the table does not name keeps its number.
            return characterMiscBlock(action.detail)?.label ?? `Misc ${action.detail}`;
        case "shoot":
            return `Shoot (${action.weapon})`;
        case "paperdoll":
            return "Inventory";
    }
}
