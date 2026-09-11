/**
 * How an animation's own vocabulary is spelled for a reader.
 *
 * One home for it, because several surfaces show the same values: the set pickers in the animation editor
 * and the conversion notes. The tables spell them for a parser - an armour LEVEL, an action struct - and
 * neither is what a control should say.
 */
import { decodeActionCode } from "./animation-schemes/actions";
import { type Action, characterActionCode, characterMiscBlock } from "./animation-schemes/character";
import { type Layout } from "./animation-schemes/layout";
import { layerLabel } from "./animation-schemes/layers";
import { blockSequences } from "./group-labels";

const ARMOUR_LABELS: Record<number, string> = {
    1: "None",
    2: "Leather",
    3: "Robe",
    4: "Plate",
};

export function armourLabel(level: number): string {
    return ARMOUR_LABELS[level] ?? `Level ${level}`;
}

/**
 * How the install's declared section reads for a person.
 *
 * The tables and INI headers spell these for a parser (`monster_large16`, `multi_new`), and the header
 * band of the editor is where a reader asks what KIND of animation is open. Every distinction the token
 * carries is kept - the direction count, the old variants, the layered spell - because two families that
 * differ only in that suffix are exactly the ones a reader needs told apart.
 *
 * An unknown section keeps the install's own word: an INI section header is an open vocabulary, so a
 * guessed label would be a confident wrong one where the token is at least searchable.
 */
const SECTION_LABELS: Record<string, string> = {
    character: "Character",
    character_old: "Character, old",
    monster: "Monster",
    monster_old: "Monster, old",
    monster_large: "Monster, large",
    monster_large16: "Monster, large, 16 directions",
    monster_icewind: "Monster, Icewind",
    monster_ankheg: "Monster, ankheg",
    monster_quadrant: "Monster, quadrants",
    monster_layered: "Monster, layered",
    monster_layered_spell: "Monster, layered spell",
    multi_new: "Multi-part",
    flying: "Flying",
    effect: "Effect",
    ambient: "Ambient",
    ambient_static: "Ambient, static",
    town_static: "Town, static",
};

export function sectionLabel(section: string): string {
    return SECTION_LABELS[section] ?? section;
}

/**
 * Every family this project has a spelling for, in the order above, each with its label.
 *
 * What a writer OFFERS, which is why it is a list rather than a lookup: a declaration names one of these,
 * and a free-text box for it invites a header no engine reads. Not closed, though - the vocabulary is an
 * install's, so a caller holding a section outside this list keeps it rather than being made to pick.
 */
export function sectionOptions(): { id: string; label: string }[] {
    return Object.entries(SECTION_LABELS).map(([id, label]) => ({ id, label }));
}

/**
 * What each file layout means, in the reader's terms rather than the resolver's.
 *
 * A `Record<Layout, string>` so a new layout is a COMPILE error here instead of a family the header
 * describes as nothing. The wording follows each layout's own definition in `layout.ts`; this is the
 * spelling of it, not a second statement of what resolves.
 */
const LAYOUT_SUMMARIES = {
    character: "one file per action per armour level",
    characterOld: "one file per action per armour level, each with a mirrored companion",
    bare: "a single file, with no suffix",
    cycles: "one file per numbered cycle",
    quadrant: "each cycle split across four files",
    splitCycles: "one file per band, numbered off its cycle",
    pieces: "a grid of tiles, one file per tile per facing",
    actions: "one file per two-letter action code",
    mixed: "one file per cycle, or a grid of tiles - whichever the install ships",
    actionsOrCycles: "one file per action code, or per numbered cycle where the animation ships none",
} as const satisfies Readonly<Record<Layout, string>>;

/**
 * The whole sentence the header's family chip carries.
 *
 * Three things a label cannot: which engine declared it, the install's own token for it - which is what a
 * reader searches the tables with - and what the family's files look like. The overlay clause is added
 * only for the two families that draw a second set of files over the body, which is the fact their names
 * are least readable about.
 */
export function familyDescription(section: string, layout: Layout | undefined): string {
    const drawn = layout === undefined ? "" : `, drawn as ${LAYOUT_SUMMARIES[layout]}`;
    const layer = layerLabel(section);
    const overlay = layer === undefined ? "" : ` It draws a ${layer} over the body.`;
    return `Infinity Engine declares this as "${section}"${drawn}.${overlay}`;
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
            // what that block depicts rather than repeating the number already in the filename. The FIRST
            // sequence of that block, not the list of them: two of these bands are also played backwards to
            // stand the creature up, and a file is named for the clip it holds rather than for every way
            // the engine runs it. Distinct per file either way, which the neutral vocabulary would not be -
            // it calls three of them stands. A digit the table does not name keeps its number.
            const block = characterMiscBlock(action.detail);
            const [primary] = block === undefined ? [] : blockSequences(block);
            return primary === undefined ? `Misc ${action.detail}` : primary.name;
        }
        case "shoot":
            return `Shoot (${action.weapon})`;
        case "paperdoll":
            return "Inventory";
    }
}
