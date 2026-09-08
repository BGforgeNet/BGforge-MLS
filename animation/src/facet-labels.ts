/**
 * How an animation's own vocabulary is spelled for a reader.
 *
 * One home for it, because several surfaces show the same values: the set pickers in the animation editor
 * and the conversion notes. The tables spell them for a parser - an armour LEVEL, an action struct - and
 * neither is what a control should say.
 */
import { decodeActionCode } from "./animation-schemes/actions";
import { type Action, characterActionCode, characterMiscBlock } from "./animation-schemes/character";
import { stanceName } from "./group-labels";

const ARMOUR_LABELS: Record<number, string> = {
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
        case "attack": {
            // A set with a weapon ships all nine, so the digit alone gives the picker nine rows nothing
            // tells apart. Named for the strike, in the naming table's own words so this and the file-name
            // banner say the same thing. The family's code space is open, so one it does not name keeps
            // its number.
            const { detail } = decodeActionCode("character", characterActionCode(action));
            return detail === undefined ? `Attack ${action.detail}` : `Attack (${detail})`;
        }
        case "cast":
            return "Cast";
        case "misc": {
            // A misc file's digit is a position in the band skeleton its family shares, so the control says
            // what that block depicts rather than repeating the number already in the filename. The block's
            // own stance name, so the two surfaces name it identically, and DISTINCT per file - these land
            // in the picker as consecutive rows, and the neutral vocabulary would call three of them stands.
            // The family's code space is open, so one the table does not name keeps its number.
            const block = characterMiscBlock(action.detail);
            return block === undefined ? `Misc ${action.detail}` : stanceName(block);
        }
        case "shoot":
            return `Shoot (${action.weapon})`;
        case "paperdoll":
            return "Inventory";
    }
}
