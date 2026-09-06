/**
 * The animation sets as a picker's options.
 *
 * One home for the labels because two controls show them: the picker the panel offers before anything is
 * drawn, and the one in the drawn surface's own controls column. A reader who searched for a set by one
 * spelling must find it by the same spelling in the other.
 */
import { type SetTile } from "./messages";

export interface SetOption {
    value: string;
    label: string;
}

const hex = (id: number): string => `0x${id.toString(16).padStart(4, "0")}`;

/**
 * The id is in every label, not just where two sets share a name.
 *
 * It is the reference the tables key on, so it is what a reader arrives with from a creature's animation
 * field - and it is what tells a family's generations apart when their names do not.
 *
 * A set that draws nothing says so IN the option rather than being dropped or disabled: it is a real
 * animation the tables name, and a row that silently vanished would read as the picker having forgotten it.
 */
export function setOptions(sets: readonly SetTile[]): SetOption[] {
    return sets.map((set) => ({
        value: String(set.id),
        label:
            set.resref === undefined
                ? `${set.label} ${hex(set.id)} - draws nothing`
                : `${set.label} ${hex(set.id)} (${set.resref})`,
    }));
}
