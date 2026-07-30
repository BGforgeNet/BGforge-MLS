/**
 * What each opcode's `resource` resref points at, transcribed per opcode from its own
 * external/infinity-engine/iesdp/_opcodes/op<NNN>*.html body. IESDP records the target only in prose and
 * phrases it differently every time ("the item specified by", "references a EFF not a SPL", "should be set to
 * the filename of the creature"), so this cannot be harvested the way the frontmatter labels are.
 *
 * Every entry names the READING it was transcribed from. An opcode number means whatever each engine makes it
 * mean, and the generated tables describe one chosen reading (see `ENGINE_PREFERENCE`) - so a type transcribed
 * from a different engine's page describes a different effect. `reading` is checked against the chosen name by
 * `opcode-relationships.test.ts`, which is what turns a silent mismatch into a failing test.
 *
 * An opcode is listed only when the pages behind that reading agree on ONE type; the deliberate omissions are
 * at the bottom. Naming the wrong type resolves a resref against the wrong namespace, which is worse than
 * leaving it unresolved.
 */

export interface ResourceDeclaration {
    /** Resource-type extension the effect's `resource` names under this opcode. */
    readonly type: string;
    /** IESDP `opname` of the reading this was transcribed from. */
    readonly reading: string;
}

export const OpcodeResourceOverrides: Readonly<Record<number, ResourceDeclaration>> = {
    // Creatures - "the creature specified by the resource key" / "filename of the creature to summon".
    67: { type: "CRE", reading: "Summon: Creature Summoning" },
    135: { type: "CRE", reading: "Graphics: Polymorph into Specific" },
    151: { type: "CRE", reading: "Summon: Replace Creature" },

    // Items - "the item specified by the resource key".
    111: { type: "ITM", reading: "Item: Create Magical Weapon" },
    112: { type: "ITM", reading: "Item: Remove Item" },
    122: { type: "ITM", reading: "Item: Create Inventory Item" },
    123: { type: "ITM", reading: "Item: Remove Inventory Item" },
    143: { type: "ITM", reading: "Item: Create Item in Slot" },
    180: { type: "ITM", reading: "Item: Can't Use Item" },
    243: { type: "ITM", reading: "Item: Drain Item Charges" },
    255: { type: "ITM", reading: "Item: Create Inventory Item (days)" },

    // Spells - "the spell specified by the resource key", or the SPL named outright.
    78: { type: "SPL", reading: "State: Disease" },
    146: { type: "SPL", reading: "Spell: Cast Spell (at Creature)" },
    147: { type: "SPL", reading: "Spell: Learn Spell" },
    148: { type: "SPL", reading: "Spell: Cast Spell (at Point)" },
    171: { type: "SPL", reading: "Spell: Give Ability" },
    172: { type: "SPL", reading: "Spell: Remove Spell" },
    206: { type: "SPL", reading: "Spell: Protection from Spell" },
    207: { type: "SPL", reading: "Spell: Bounce (by Resource)" },
    232: { type: "SPL", reading: "Spell Effect: Cast Spell on Condition" },
    251: { type: "SPL", reading: "Spell Effect: Change Bard Song Effect" },
    252: { type: "SPL", reading: "Spell Effect: Set Trap" },
    258: { type: "SPL", reading: "Spell: Spell Sequencer Activation" },
    260: { type: "SPL", reading: "Spell: Spell Sequencer Activation" },
    266: { type: "SPL", reading: "Spell: Remove Protection from Spell" },
    313: { type: "SPL", reading: "High-Level Ability Denotation" },
    326: { type: "SPL", reading: "Apply Effects List" },
    333: { type: "SPL", reading: "Spell Effect: Static Charge" },
    // Granted as through opcode #171, so the same SPL.
    335: { type: "SPL", reading: "Spell Effect: Seven Eyes" },
    340: { type: "SPL", reading: "Spell Effect: Change Backstab Effect" },
    341: { type: "SPL", reading: "Spell Effect: Change Critical Hit Effect" },
    361: { type: "SPL", reading: "Cast spell on critical miss" },
    366: { type: "SPL", reading: "Spell: Apply Spell On Move" },

    // The decrementing bounce/immunity family, whose pages all read "On EE games, resource field -> Spell cast
    // when this effect self-terminates". Their non-decrementing siblings (197-199, 202, 203) are NOT here: those
    // pages mention only the resource key of the spells being bounced, never a field of their own.
    200: { type: "SPL", reading: "Spell: Bounce (by Power level, decrementing)" },
    201: { type: "SPL", reading: "Spell: Immunity (by Power Level, decrementing)" },
    223: { type: "SPL", reading: "Spell: Immunity (by School, decrementing)" },
    226: { type: "SPL", reading: "Spell: Immunity (by Secondary Type, decrementing)" },
    227: { type: "SPL", reading: "Spell: Bounce (by School, decrementing)" },
    228: { type: "SPL", reading: "Spell: Bounce (by Secondary Type, decrementing)" },
    259: { type: "SPL", reading: "Protection: Spell Trap (by Power Level, decrementing)" },

    // Effects. 248 and 249 say it outright: "The resource key references a EFF not a SPL".
    177: { type: "EFF", reading: "Use EFF File" },
    183: { type: "EFF", reading: "Item: Apply Effect Itemtype" },
    248: { type: "EFF", reading: "Item: Set Melee Effect" },
    249: { type: "EFF", reading: "Item: Set Ranged Effect" },
    272: { type: "EFF", reading: "Spell: Apply Repeating EFF" },

    // Tables - each names a 2DA the effect reads instead of its built-in one.
    214: { type: "2DA", reading: "Spell Effect: Select Spell" },
    273: { type: "2DA", reading: "Remove: Specific Area Effect(Zone of Sweet Air)" },
    331: { type: "2DA", reading: "Summon: Random Monster Summoning" },

    // Single-type odds and ends.
    82: { type: "BCS", reading: "Set AI Script" },
    107: { type: "BMP", reading: "Portrait Change" },
    174: { type: "WAV", reading: "Spell Effect: Play Sound Effect" },
    186: { type: "ARE", reading: "Script: MoveToArea" },
    // The animation filename is built from this resref plus the Sequence field.
    336: { type: "BAM", reading: "Graphics: Display Eyes Overlay" },
};

/**
 * Opcodes whose `resource` is populated but deliberately left unresolved, so the omission reads as a decision.
 *
 * - Two types at once: 215 ("the BAM/VVC"), 321 ("Both SPL and ITM resources are considered").
 * - The chosen reading gives the field no documented use, and only another engine's does: 41 (a BAM, but only
 *   on the PSTEE page - the BG(2)EE Sparkle documents no resource), 352 (a background BMP on PSTEE, where the
 *   BG(2)EE reading of the number is "Unused"), 152, 182, 256.
 * - Not a resref at all - the field holds a name: 265 and 309 (a global / local variable), 296, 319 (slot 11
 *   is the actor's scripting name).
 */
export const OPCODE_RESOURCE_UNRESOLVED = [41, 152, 182, 215, 256, 265, 296, 309, 319, 321, 352] as const;
