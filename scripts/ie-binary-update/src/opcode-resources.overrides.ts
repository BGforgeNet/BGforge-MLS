/**
 * What each opcode's `resource` resref points at, transcribed per opcode from its own
 * external/infinity-engine/iesdp/_opcodes/op<NNN>*.html body. IESDP records the target only in prose and
 * phrases it differently every time ("the item specified by", "references a EFF not a SPL", "should be set to
 * the filename of the creature"), so this cannot be harvested the way the frontmatter labels are.
 *
 * An opcode is listed only when every page documenting it agrees on ONE type. The deliberate omissions are
 * at the bottom: naming the wrong type resolves a resref against the wrong namespace, which is worse than
 * leaving it unresolved.
 */

import type { OpcodeRelationship } from "./extract-opcodes.ts";

export const OpcodeResourceOverrides: Readonly<Record<number, OpcodeRelationship>> = {
    // Creatures - "the creature specified by the resource key" / "filename of the creature to summon".
    67: { resourceType: "CRE" }, // Summon: Creature Summoning
    135: { resourceType: "CRE" }, // Graphics: Polymorph into Specific
    151: { resourceType: "CRE" }, // Summon: Replace Creature

    // Items - "the item specified by the resource key".
    111: { resourceType: "ITM" }, // Item: Create Magical Weapon
    112: { resourceType: "ITM" }, // Item: Remove Item
    122: { resourceType: "ITM" }, // Item: Create Inventory Item
    123: { resourceType: "ITM" }, // Item: Remove Inventory Item
    143: { resourceType: "ITM" }, // Item: Create Item in Slot
    180: { resourceType: "ITM" }, // Item: Can't Use Item
    243: { resourceType: "ITM" }, // Item: Drain Item Charges
    255: { resourceType: "ITM" }, // Item: Create Inventory Item (days)

    // Spells - "the spell specified by the resource key", or the SPL named outright.
    78: { resourceType: "SPL" }, // State: Disease
    146: { resourceType: "SPL" }, // Spell: Cast Spell (at Creature)
    147: { resourceType: "SPL" }, // Spell: Learn Spell
    148: { resourceType: "SPL" }, // Spell: Cast Spell (at Point)
    171: { resourceType: "SPL" }, // Spell: Give Ability
    172: { resourceType: "SPL" }, // Spell: Remove Spell
    206: { resourceType: "SPL" }, // Spell: Protection from Spell
    207: { resourceType: "SPL" }, // Spell: Bounce (by Resource)
    232: { resourceType: "SPL" }, // Spell Effect: Cast Spell on Condition
    251: { resourceType: "SPL" }, // Spell Effect: Change Bard Song Effect
    252: { resourceType: "SPL" }, // Spell Effect: Set Trap
    258: { resourceType: "SPL" }, // Spell: Spell Sequencer Activation
    260: { resourceType: "SPL" }, // Spell: Spell Sequencer Activation
    266: { resourceType: "SPL" }, // Spell: Remove Protection from Spell
    313: { resourceType: "SPL" }, // High-Level Ability Denotation
    326: { resourceType: "SPL" }, // Apply Effects List
    333: { resourceType: "SPL" }, // Spell Effect: Static Charge
    335: { resourceType: "SPL" }, // Spell Effect: Seven Eyes - granted as through opcode #171
    340: { resourceType: "SPL" }, // Spell Effect: Change Backstab Effect
    341: { resourceType: "SPL" }, // Spell Effect: Change Critical Hit Effect
    361: { resourceType: "SPL" }, // Cast spell on critical miss
    366: { resourceType: "SPL" }, // Spell: Apply Spell On Move

    // The decrementing bounce/immunity family, whose pages all read "On EE games, resource field -> Spell cast
    // when this effect self-terminates". Their non-decrementing siblings (197-199, 202, 203) are NOT here: those
    // pages mention only the resource key of the spells being bounced, never a field of their own.
    200: { resourceType: "SPL" }, // Spell: Bounce (by Power level, decrementing)
    201: { resourceType: "SPL" }, // Spell: Immunity (by Power Level, decrementing)
    223: { resourceType: "SPL" }, // Spell: Immunity (by School, decrementing)
    226: { resourceType: "SPL" }, // Spell: Immunity (by Secondary Type, decrementing)
    227: { resourceType: "SPL" }, // Spell: Bounce (by School, decrementing)
    228: { resourceType: "SPL" }, // Spell: Bounce (by Secondary Type, decrementing)
    259: { resourceType: "SPL" }, // Protection: Spell Trap (by Power Level, decrementing)

    // Effects. 248 and 249 say it outright: "The resource key references a EFF not a SPL".
    177: { resourceType: "EFF" }, // Use EFF File
    183: { resourceType: "EFF" }, // Item: Apply Effect Itemtype
    248: { resourceType: "EFF" }, // Item: Set Melee Effect
    249: { resourceType: "EFF" }, // Item: Set Ranged Effect
    272: { resourceType: "EFF" }, // Spell: Apply Repeating EFF

    // Tables - each names a 2DA the effect reads instead of its built-in one.
    214: { resourceType: "2DA" }, // Spell Effect: Select Spell
    273: { resourceType: "2DA" }, // Remove: Specific Area Effect - a custom CLEARAIR.2DA
    331: { resourceType: "2DA" }, // Summon: Random Monster Summoning

    // Single-type odds and ends.
    41: { resourceType: "BAM" }, // Graphics: Sparkle - PSTEE only; no other page gives this field a use
    82: { resourceType: "BCS" }, // Set AI Script
    107: { resourceType: "BMP" }, // Portrait Change
    174: { resourceType: "WAV" }, // Spell Effect: Play Sound Effect
    186: { resourceType: "ARE" }, // Script: MoveToArea
    336: { resourceType: "BAM" }, // Graphics: Display Eyes Overlay - filename built from this resref
    352: { resourceType: "BMP" }, // PSTEE background image
};

/**
 * Opcodes whose `resource` is populated but deliberately left unresolved, so the omission reads as a decision.
 *
 * - Two types at once: 215 ("the BAM/VVC"), 321 ("Both SPL and ITM resources are considered").
 * - The opcode itself differs by engine, so the field means different things: 152 (movie container differs by
 *   edition), 182, 256, 283.
 * - Not a resref at all - the field holds a name: 265 and 309 (a global / local variable), 296, 319 (slot 11
 *   is the actor's scripting name).
 */
export const OPCODE_RESOURCE_UNRESOLVED = [152, 182, 215, 256, 265, 283, 296, 309, 319, 321] as const;
