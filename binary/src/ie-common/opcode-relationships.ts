// Auto-generated from IESDP _opcodes/opNNN.html. Do not hand-edit.

/** One opcode-dependent field's display data: what to call it, and the values it is known to take. */
export interface OpcodeSlot {
    label?: string;
    enum?: Readonly<Record<number, string>>;
}

/**
 * One engine's reading of an opcode number. There is no engine-neutral definition: 238 is
 * "Stat: Save vs. all" on Icewind Dale and "Death: Disintegrate" on BG2/EE. Resolve with
 * `opcodeReading(opcode, engine)` rather than indexing, so the fallback stays in one place.
 */
export interface OpcodeRelationship {
    /** What this engine calls the opcode. */
    name?: string;
    /** The engines that read the opcode this way. */
    engines?: readonly string[];
    param1?: OpcodeSlot;
    param2?: OpcodeSlot;
    /** EE-era extra parameters; present only for the minority of opcodes that read them. */
    param3?: OpcodeSlot;
    param4?: OpcodeSlot;
    param5?: OpcodeSlot;
    /** The dword the spec calls a TobEx stacking id, which these opcodes read as their own field. */
    special?: OpcodeSlot;
    savingthrow?: OpcodeSlot;
    power?: OpcodeSlot;
    /** Which engines have the opcode AT ALL - spans every reading, unlike `engines` above. */
    availability?: Readonly<Record<string, boolean>>;
    /**
     * For the opcodes that read parameter1 as an entry in an IDS file parameter2 SELECTS: parameter2's
     * stored value -> the candidate tables it names, most preferred first (every present one contributes
     * and the earlier wins a shared key, since editions disagree - ALIGN vs ALIGNMEN). The mapping is per
     * opcode, not shared: 72 is 0-based where 55/100/175 are 2-based, and 178's slot 2 is OBJECT not EA.
     */
    idsFileByParam2?: Readonly<Record<number, readonly string[]>>;
    /**
     * What the effect's `resource` resref points at, as a resource-type extension. Per reading, since
     * two engines sharing a number can point it at different namespaces; absent where the reading's
     * pages name no target, or name two at once.
     */
    resourceType?: string;
}

/** Readings per opcode, most-preferred engine first. See `opcodeReading` for the selection rule. */
export const OpcodeReadings: Readonly<Record<number, readonly OpcodeRelationship[]>> = {
    0: [
        { name: "Stat: AC vs. Damage Type Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "AC Modifier" }, param2: { label: "Type", enum: { 0: "All", 1: "Crushing", 2: "Missile", 4: "Piercing", 8: "Slashing", 16: "Base AC Setting" } }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    1: [
        { name: "Stat: Attacks Per Round Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Key Modifier" }, param2: { label: "Type", enum: { 0: "Cumulative Modifier", 1: "Flat Value Modifier", 2: "Percentage Modifier", 3: "Cumulative Modifier" } }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    2: [
        { name: "Cure: Sleep", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    3: [
        { name: "State: Berserking", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type", enum: { 0: "Default/In Combat", 1: "Constant", 2: "Blood Rage" } }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    4: [
        { name: "Cure: Berserking", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    5: [
        { name: "Charm: Charm Specific Creature", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "General Type" }, param2: { label: "Charm Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    6: [
        { name: "Stat: Charisma Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    7: [
        { name: "Colour: Set Character colours by Palette", engines: ["bg1", "bg2", "bgee", "iwd2", "pst", "pstee"], param1: { label: "Gradient Number" }, param2: { label: "Location" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Colour: Set character colours by Palette", engines: ["iwd1"], param1: { label: "Gradient Number" }, param2: { label: "Location" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    8: [
        { name: "Colour: Change by RGB", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "RGB colour" }, param2: { label: "Location" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Colour: Colour Glow Solid", engines: ["pst"], param1: { label: "RGB Colour" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    9: [
        { name: "Colour: Glow Pulse", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "RGB Colour" }, param2: { label: "Location and Speed" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Colour: Colour Glow Pulsate", engines: ["pst"], param1: { label: "RGB Colour" }, param2: { label: "Pulse Speed" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    10: [
        { name: "Stat: Constitution Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    11: [
        { name: "Cure: Poison", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    12: [
        { name: "HP: Damage", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Damage Amount" }, param2: { label: "Mode & Damage Type" }, special: { label: "Flags" }, savingthrow: { label: "Save Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Damage", engines: ["pst"], param1: { label: "Fixed Damage" }, param2: { label: "Damage Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    13: [
        { name: "Death: Instant Death", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Text Notification" }, param2: { label: "Death Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Death", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Death State?" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    14: [
        { name: "Graphics: Defrost", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Defrost", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    15: [
        { name: "Stat: Dexterity Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    16: [
        { name: "State: Haste", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    17: [
        { name: "HP: Current HP Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    18: [
        { name: "HP: Maximum HP Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, special: { label: "Mode" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    19: [
        { name: "Stat: Intelligence Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type", enum: { 0: "Cumulative Modifier", 1: "Flat Value Modifier", 2: "Percentage Modifier" } }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    20: [
        { name: "State: Invisibility", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Invisibility (state)", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    21: [
        { name: "Stat: Lore Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    22: [
        { name: "Stat: Cumulative Luck Bonus", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Stat: Cumulative Luck Modifier", engines: ["iwd2"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    23: [
        { name: "Stat: Morale Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, special: { label: "Mode" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    24: [
        { name: "State: Horror", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    25: [
        { name: "State: Poison", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Amount_1" }, param2: { label: "Type", enum: { 0: "1 HP per second (nonzero amount)", 1: "1 HP per second (amount > 1)", 2: "Damage Amount per second", 3: "1 HP every Damage Amount seconds" } }, param3: { label: "Amount_2" }, param4: { label: "Frequency Multiplier" }, special: { label: "Icon" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Poison Target", engines: ["pst"], param1: { label: "Variable" }, param2: { label: "Poison Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    26: [
        { name: "Item: Remove Curse", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Remove Curse", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    27: [
        { name: "Stat: Acid Resistance Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    28: [
        { name: "Stat: Cold Resistance Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    29: [
        { name: "Stat: Electricity Resistance Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    30: [
        { name: "Stat: Fire Resistance Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    31: [
        { name: "Stat: Magic Damage Resistance Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    32: [
        { name: "Cure: Death (Raise Dead)", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Restore creature animation?" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    33: [
        { name: "Stat: Save vs. Death Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Stat: Save vs. Fortitude Modifier", engines: ["iwd2"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    34: [
        { name: "Stat: Save vs. Wands Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Stat: Save vs. Reflex Modifier", engines: ["iwd2"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    35: [
        { name: "Stat: Save vs. Petrification/Polymorph Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Stat: Save vs. Will Modifier", engines: ["iwd2"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    36: [
        { name: "Stat: Save vs. Breath Weapons Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Deprecated", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    37: [
        { name: "Stat: Save vs. Spells Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Deprecated", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    38: [
        { name: "State: Silence", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    39: [
        { name: "State: Unconsciousness", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Wake on Damage?", enum: { 0: "Yes", 1: "No" } }, special: { label: "Icon" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Unconsciousness (Helpless)", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    40: [
        { name: "State: Slow", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    41: [
        { name: "Graphics: Sparkle", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Colour" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Sparkle", engines: ["iwd2"], param1: { label: "Sparkle Color" }, param2: { label: "Sparkle Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    42: [
        { name: "Spell: Wizard Spell Slots Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Slot Amount Modifier" }, param2: { label: "Spell Level" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    43: [
        { name: "Cure: Stone to Flesh", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    44: [
        { name: "Stat: Strength Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    45: [
        { name: "State: Stun", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    46: [
        { name: "Cure: Stun (Unstun)", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Unstun", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    47: [
        { name: "Cure: Invisibility", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    48: [
        { name: "Cure: Silence (Vocalize)", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    49: [
        { name: "Stat: Wisdom Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    50: [
        { name: "Colour: Glow by RGB (Brief)", engines: ["bg1", "bg2", "bgee", "iwd1", "pstee"], param1: { label: "RGB Colour" }, param2: { label: "Location and Speed" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Single Color Pulse All", engines: ["iwd2"], param1: { label: "RGB Color" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Character Colourglow (Timed)", engines: ["pst"], param1: { label: "RGB Colour" }, param2: { label: "Timing" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    51: [
        { name: "Colour: Strong/Dark by RGB", engines: ["bg1", "bg2", "bgee", "iwd1", "pstee"], param1: { label: "RGB Colour" }, param2: { label: "Location" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Color Tint solid", engines: ["iwd2"], param1: { label: "RGB Color" }, param2: { label: "Location" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    52: [
        { name: "Colour: Very Bright by RGB", engines: ["bg1", "bg2", "bgee", "iwd1", "pstee"], param1: { label: "RGB Colour" }, param2: { label: "Location" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Color Light Solid", engines: ["iwd2"], param1: { label: "RGB Color" }, param2: { label: "Location" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Character Colourglow (Instant II)", engines: ["pst"], param1: { label: "RGB Colour" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    53: [
        { name: "Graphics: Animation Change", engines: ["bg1", "bg2", "bgee", "pstee"], param1: { label: "Animation ID" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Animation Change", engines: ["iwd2"], param1: { label: "Animation Type" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Animation ID Modifier", engines: ["pst"], param1: { label: "Animation Set" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    54: [
        { name: "Stat: THAC0 Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Stat: Base Attack Bonus Modifier", engines: ["iwd2"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    55: [
        { name: "Death: Kill Creature Type", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, idsFileByParam2: { 2: ["EA"], 3: ["GENERAL"], 4: ["RACE"], 5: ["CLASS"], 6: ["SPECIFIC"], 7: ["GENDER"], 8: ["ALIGN", "ALIGNMEN"], 9: ["KIT"] } },
        { name: "Kill Creature Type", engines: ["pst"], param1: { label: "Index Number" }, param2: { label: "IDS File" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    56: [
        { name: "Alignment: Invert", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    57: [
        { name: "Alignment: Change", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Alignment" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    58: [
        { name: "Cure: Dispellable Effects (Dispel Magic)", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Level" }, param2: { label: "Dispel Type & Magic Weapon Dispel Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    59: [
        { name: "Stat: Stealth Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    60: [
        { name: "Stat: Miscast Magic", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Percent Chance" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    61: [
        { name: "Creature RGB color fade", engines: ["bgee", "pstee"], param1: { label: "RGB Colour" }, param2: { label: "Location and Fade Speed" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Crash", engines: ["bg1", "bg2", "iwd1", "pst"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Stat: Alchemy", engines: ["iwd2"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    62: [
        { name: "Spell: Priest Spell Slots Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Slot Amount Modifier" }, param2: { label: "Spell Level" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    63: [
        { name: "State: Infravision", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    64: [
        { name: "State: Remove Infravision", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    65: [
        { name: "Overlay: Blur", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    66: [
        { name: "Graphics: Transparency Fade", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Fade Amount" }, param2: { label: "Visual Effect" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Transparency Fade", engines: ["pst"], param1: { label: "Fade Amount" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    67: [
        { name: "Summon: Creature Summoning", engines: ["bg1", "bg2", "bgee", "iwd1", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Mode" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "CRE" },
        { name: "Summon", engines: ["iwd2"], param1: { label: "Creature Number" }, param2: { label: "Summoning Animation" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Creature Summoning (Ally)", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    68: [
        { name: "Summon: Unsummon Creature", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Text Notification" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    69: [
        { name: "Protection: From Detection (Non-Detection)", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    70: [
        { name: "Cure: Non-Detection", engines: ["bg1", "bg2", "bgee", "iwd1", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "(End Non-Detection)", engines: ["iwd2"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "End Non-Detection", engines: ["pst"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    71: [
        { name: "IDS: Sex Change", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Gender Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    72: [
        { name: "IDS: Set IDS State", engines: ["bg1", "bg2", "bgee", "iwd1", "pstee"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, idsFileByParam2: { 0: ["EA"], 1: ["GENERAL"], 2: ["RACE"], 3: ["CLASS"], 4: ["SPECIFIC"], 5: ["GENDER"], 6: ["ALIGN", "ALIGNMEN"] } },
        { name: "AI Change", engines: ["iwd2"], param1: { label: "Reaction State" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "AI Identifier Modifier", engines: ["pst"], param1: { label: "IDS Value" }, param2: { label: "Identifier Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    73: [
        { name: "Stat: Extra Damage Modifier", engines: ["bg1", "bg2", "bgee", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Modifier Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Damage Mod", engines: ["iwd1", "iwd2"], param1: { label: "Damage Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    74: [
        { name: "State: Blindness", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    75: [
        { name: "Cure: Blindness", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    76: [
        { name: "State: Feeblemindedness", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    77: [
        { name: "Cure: Feeblemindedness", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    78: [
        { name: "State: Disease", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Amount" }, param2: { label: "Type" }, param4: { label: "Frequency Multiplier" }, special: { label: "Icon" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "SPL" },
    ],
    79: [
        { name: "Cure: Disease", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    80: [
        { name: "State: Deafness", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    81: [
        { name: "Cure: Deafness", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    82: [
        { name: "Set AI Script", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "BCS" },
        { name: "Incite Berserk Attack", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    83: [
        { name: "Protection: From Projectile", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Projectile Index" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Protection: From Projectile Weapon", engines: ["bg1", "iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Protection From Projectile/Special Graphic Effect", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Index Number" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    84: [
        { name: "Stat: Magical Fire Resistance Modifier", engines: ["bg1", "bg2", "bgee", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    85: [
        { name: "Stat: Magical Cold Resistance Modifier", engines: ["bg1", "bg2", "bgee", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    86: [
        { name: "Stat: Slashing Resistance Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    87: [
        { name: "Stat: Crushing Resistance Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    88: [
        { name: "Stat: Piercing Resistance Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    89: [
        { name: "Stat: Missiles Resistance Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    90: [
        { name: "Stat: Open Locks Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    91: [
        { name: "Stat: Find Traps Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    92: [
        { name: "Stat: Pick Pockets Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    93: [
        { name: "Stat: Fatigue Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    94: [
        { name: "Stat: Drunkenness Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    95: [
        { name: "Stat: Tracking Skill Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    96: [
        { name: "Stat: Level Change", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    97: [
        { name: "Stat: Exceptional Strength Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    98: [
        { name: "HP: Regeneration", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Amount_1" }, param2: { label: "Type" }, param3: { label: "Amount_2" }, param4: { label: "Frequency Multiplier" }, special: { label: "Icon" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Regeneration", engines: ["pst"], param1: { label: "Regen/Time" }, param2: { label: "Regen Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    99: [
        { name: "Spell Effect: Duration Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Duration Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    100: [
        { name: "Protection: from Creature Type", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, idsFileByParam2: { 2: ["EA"], 3: ["GENERAL"], 4: ["RACE"], 5: ["CLASS"], 6: ["SPECIFIC"], 7: ["GENDER"], 8: ["ALIGN", "ALIGNMEN"], 9: ["KIT"] } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    101: [
        { name: "Protection: from Opcode", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Opcode" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    102: [
        { name: "Spell: Immunity (by Power Level)", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Spell Level" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    103: [
        { name: "Text: Change Name", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "String Reference" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    104: [
        { name: "Stat: Experience Points", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    105: [
        { name: "Stat: Gold", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    106: [
        { name: "Stat: Morale Break Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    107: [
        { name: "Portrait Change", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "BMP" },
    ],
    108: [
        { name: "Stat: Reputation", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    109: [
        { name: "State: Paralyze", engines: ["bgee", "pstee"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, special: { label: "Mode" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, idsFileByParam2: { 2: ["EA"], 3: ["GENERAL"], 4: ["RACE"], 5: ["CLASS"], 6: ["SPECIFIC"], 7: ["GENDER"], 8: ["ALIGN", "ALIGNMEN"], 9: ["KIT"] } },
        { name: "State: Hold", engines: ["bg1", "bg2", "iwd1", "iwd2"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Helplessness Set in Creature Type", engines: ["pst"], param1: { label: "Index Number" }, param2: { label: "IDS File" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    110: [
        { name: "Empty:", engines: ["bg2", "bgee", "iwd1", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "(Retreat From)", engines: ["bg1"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Run Away", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    111: [
        { name: "Item: Create Magical Weapon", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Amount" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "ITM" },
    ],
    112: [
        { name: "Item: Remove Item", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Sound" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "ITM" },
    ],
    113: [
        { name: "Empty:", engines: ["bg2", "bgee", "iwd1", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Item: (Equip Weapon)", engines: ["bg1", "iwd2", "pst"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    114: [
        { name: "Graphics: Dither", engines: ["bg1", "bg2", "bgee", "iwd2", "pst", "pstee"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    115: [
        { name: "Detect: Alignment", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Alignment Mask" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    116: [
        { name: "State: Cure Invisibility", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    117: [
        { name: "Spell Effect: Reveal Area", engines: ["bg1", "bg2", "bgee", "iwd1", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Spell Effect: Clairvoyance", engines: ["iwd2", "pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    118: [
        { name: "Empty:", engines: ["bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Detect: (Show Creatures)", engines: ["bg1", "pst"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    119: [
        { name: "Spell Effect: Mirror Image", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    120: [
        { name: "Protection: from Weapons", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Enchantment" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    121: [
        { name: "Empty:", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    122: [
        { name: "Item: Create Inventory Item", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Charges" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "ITM" },
    ],
    123: [
        { name: "Item: Remove Inventory Item", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "ITM" },
    ],
    124: [
        { name: "Spell Effect: Teleport (Dimension Door)", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Teleport to a Given Point", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    125: [
        { name: "Spell Effect: Unlock (Knock)", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    126: [
        { name: "Stat: Movement Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Walk/Run Distance Modifier", engines: ["pst"], param1: { label: "Distance" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    127: [
        { name: "Summon: Monster Summoning", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Number" }, param2: { label: "Type" }, special: { label: "Mode" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    128: [
        { name: "State: Confusion", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    129: [
        { name: "State: Aid", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Aid (Non-commulitive)", engines: ["pst"], param1: { label: "Statistic Modifier" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    130: [
        { name: "State: Bless", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Modifier" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Bless (Non-commultive)", engines: ["pst"], param1: { label: "Statistic Modifier" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    131: [
        { name: "State: Positive Chant", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Modifier" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "State: Chant", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    132: [
        { name: "State: Raise Strength, Constitution, & Dexterity Non-Cumulative", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    133: [
        { name: "Spell Effect: Luck Non-Cumulative", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    134: [
        { name: "State: Petrification", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    135: [
        { name: "Graphics: Polymorph into Specific", engines: ["bg1", "bg2", "bgee", "iwd1", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "CRE" },
        { name: "Polymorph into Specific", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Polymorph", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Change Specifics" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    136: [
        { name: "State: Force Visible", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    137: [
        { name: "State: Negative Chant", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Modifier" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    138: [
        { name: "Graphics: Character Animation Change", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Animation Sequence" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Animation State Change", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Animation Sequence" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    139: [
        { name: "Text: Display String", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "String Reference" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    140: [
        { name: "Graphics: Casting Glow", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Projectile Index" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Casting Glow", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    141: [
        { name: "Graphics: Lighting Effects", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Target" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    142: [
        { name: "Graphics: Display Special Effect Icon", engines: ["bg1", "bg2", "bgee", "iwd1", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Icon" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Portrait Icon", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Icon Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    143: [
        { name: "Item: Create Item in Slot", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Slot" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "ITM" },
        { name: "Replace Item", engines: ["pst"], param1: { label: "Slot Type" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    144: [
        { name: "Button: Disable Button", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Button" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    145: [
        { name: "Spell: Disable Spell Casting Abilities", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Spell Type" }, special: { label: "Show message?" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    146: [
        { name: "Spell: Cast Spell (at Creature)", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Casting Level" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "SPL" },
        { name: "Spell: Cast Spell (as Target)", engines: ["iwd2"], param1: { label: "Casting Level" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    147: [
        { name: "Spell: Learn Spell", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "SPL" },
        { name: "Learn Spell", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Spell Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    148: [
        { name: "Spell: Cast Spell (at Point)", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Casting Level" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "SPL" },
    ],
    149: [
        { name: "(Identify)", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    150: [
        { name: "Spell Effect: Find Traps", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    151: [
        { name: "Summon: Replace Creature", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "CRE" },
        { name: "Creature Summoning (Replace)", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    152: [
        { name: "Spell Effect: Play Movie", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    153: [
        { name: "Overlay: Sanctuary", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Mode" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    154: [
        { name: "Overlay: Entangle", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Mode" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    155: [
        { name: "Overlay: Minor Globe", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Mode" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    156: [
        { name: "Overlay: Protection from Normal Missiles Cylinder", engines: ["bg1", "bg2", "bgee", "iwd1", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Mode" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    157: [
        { name: "State: Web Effect", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Mode" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    158: [
        { name: "Overlay: Grease", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Mode" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    159: [
        { name: "Spell Effect: Mirror Image (Exact Number)", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Amount" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    160: [
        { name: "Remove Sanctuary", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    161: [
        { name: "Cure: Horror", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    162: [
        { name: "Cure: Hold", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Remove Helplessness", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    163: [
        { name: "Protection: Free Action", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    164: [
        { name: "Cure: Drunkeness", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    165: [
        { name: "Spell Effect: Pause Target", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    166: [
        { name: "Stat: Magic Resistance Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Resistance to Magic Damage", engines: ["pst"], param1: { label: "Statistic Modifier" }, param2: { label: "Modifier Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    167: [
        { name: "Stat: THAC0 Modifier with Missile Weapons", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Missile THAC0 Bonus", engines: ["pst"], param1: { label: "Bonus" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    168: [
        { name: "Summon: Remove Creature", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Destroy Target", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    169: [
        { name: "Graphics: Prevent Special Effect Icon", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Icon" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    170: [
        { name: "Graphics: Play Damage Animation", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Animation" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Unknown Effect #170", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    171: [
        { name: "Spell: Give Ability", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "SPL" },
    ],
    172: [
        { name: "Spell: Remove Spell", engines: ["bg1", "bg2", "bgee", "iwd2", "pst", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "SPL" },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    173: [
        { name: "Stat: Poison Resistance Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    174: [
        { name: "Spell Effect: Play Sound Effect", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "WAV" },
        { name: "Play Sound", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    175: [
        { name: "State: Hold", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, idsFileByParam2: { 2: ["EA"], 3: ["GENERAL"], 4: ["RACE"], 5: ["CLASS"], 6: ["SPECIFIC"], 7: ["GENDER"], 8: ["ALIGN", "ALIGNMEN"] } },
    ],
    176: [
        { name: "Stat: Movement Modifier (II)", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    177: [
        { name: "Use EFF File", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, param3: { label: "Bypass probability / immunities / saving throws" }, param5: { label: "Bypass probability / immunities / saving throws" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, idsFileByParam2: { 2: ["EA"], 3: ["GENERAL"], 4: ["RACE"], 5: ["CLASS"], 6: ["SPECIFIC"], 7: ["GENDER"], 8: ["ALIGN", "ALIGNMEN"], 9: ["KIT"] }, resourceType: "EFF" },
    ],
    178: [
        { name: "Spell Effect: THAC0 vs. Creature Type Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "pstee"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, special: { label: "Statistic Modifier" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: false, pst: true, pstee: true }, idsFileByParam2: { 2: ["OBJECT"], 3: ["GENERAL"], 4: ["RACE"], 5: ["CLASS"], 6: ["SPECIFIC"], 7: ["GENDER"] } },
        { name: "zzzzCRASH #178", engines: ["pst"], param1: { label: "Not Valid" }, param2: { label: "Not Valid" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: false, pst: true, pstee: true } },
    ],
    179: [
        { name: "Spell Effect: Damage vs. Creature Type Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "pstee"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, special: { label: "Statistic Modifier" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: false, pst: true, pstee: true }, idsFileByParam2: { 2: ["EA"], 3: ["GENERAL"], 4: ["RACE"], 5: ["CLASS"], 6: ["SPECIFIC"], 7: ["GENDER"], 8: ["ALIGN", "ALIGNMEN"], 9: ["KIT"] } },
        { name: "zzzzCRASH #179", engines: ["pst"], param1: { label: "Not Valid" }, param2: { label: "Not Valid" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: false, pst: true, pstee: true } },
    ],
    180: [
        { name: "Item: Can't Use Item", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "String Reference" }, param2: { label: "Undefined" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "ITM" },
        { name: "zzzzCRASH #180", engines: ["pst"], param1: { label: "Not Valid" }, param2: { label: "Not Valid" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    181: [
        { name: "Item: Can't Use Itemtype", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Item Type" }, param2: { label: "Restriction" }, special: { label: "Description note" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "zzzzCRASH #181", engines: ["pst"], param1: { label: "Not Valid" }, param2: { label: "Not Valid" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    182: [
        { name: "Use EFF file if/while item resource equipped", engines: ["bgee", "pstee"], param1: { label: "Unused" }, param2: { label: "Unused" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Item: Apply Effect Item", engines: ["bg1", "bg2", "iwd1", "iwd2", "pst"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    183: [
        { name: "Item: Apply Effect Itemtype", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Undetermined" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "EFF" },
        { name: "zzzzCRASH #183", engines: ["pst"], param1: { label: "Not Valid" }, param2: { label: "Not Valid" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    184: [
        { name: "Graphics: Passwall (Don't Jump)", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"], param1: { label: "Undefined" }, param2: { label: "Jump" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    185: [
        { name: "State: Hold (II)", engines: ["bg2", "bgee", "iwd1", "pstee"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, idsFileByParam2: { 2: ["EA"], 3: ["GENERAL"], 4: ["RACE"], 5: ["CLASS"], 6: ["SPECIFIC"], 7: ["GENDER"], 8: ["ALIGN", "ALIGNMEN"], 9: ["KIT"] } },
        { name: "State: Hold", engines: ["bg1"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "zzzzCRASH #185", engines: ["pst"], param1: { label: "Not Valid" }, param2: { label: "Not Valid" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    186: [
        { name: "Script: MoveToArea", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Delay" }, param2: { label: "Orientation" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "ARE" },
        { name: "Set Status Effect(s)", engines: ["pst"], param1: { label: "Set Type" }, param2: { label: "Effect Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    187: [
        { name: "Script: Store Local Variable", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Value" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Play BAM File Blended and Sticky", engines: ["pst"], param1: { label: "RGB" }, param2: { label: "Method" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    188: [
        { name: "Spell Effect: Aura Cleansing", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Stat Value" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Play BAM File Not Blended", engines: ["pst"], param1: { label: "RGB" }, param2: { label: "Method" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    189: [
        { name: "Stat: Casting Time Modifier", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Speed Modifier" }, param2: { label: "Type" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Play BAM File Not Blended", engines: ["pst"], param1: { label: "RGB" }, param2: { label: "Method" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    190: [
        { name: "Stat: Attack Speed Factor", engines: ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Speed Modifier" }, param2: { label: "Irrelevant" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Play BAM File Not Blended", engines: ["pst"], param1: { label: "RGB" }, param2: { label: "Method" }, availability: { bg1: true, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    191: [
        { name: "Spell: Casting Level Modifier", engines: ["bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Play BAM File Not Blended", engines: ["pst"], param1: { label: "RGB" }, param2: { label: "Method" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    192: [
        { name: "Spell Effect: Find Familiar", engines: ["bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Upgrade Marker" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Hit Point Transfer", engines: ["pst"], param1: { label: "Fixed Drain" }, param2: { label: "Drain Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    193: [
        { name: "Spell Effect: Invisible Detection by Script", engines: ["bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Vibrate Playing Screen", engines: ["pst"], param1: { label: "Magnitude" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    194: [
        { name: "Ignore Dialog Pause", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Flash Playing Screen", engines: ["pst"], param1: { label: "RGB Ratio" }, param2: { label: "Unused" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    195: [
        { name: "Spell Effect: Death Dependent Constitution Loss (Familiar Bond)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Max HP Modifier" }, param2: { label: "Unused" }, param3: { label: "Master ID (owner)" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: false, pst: true, pstee: true } },
        { name: "Unknown", engines: ["iwd1"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: false, pst: true, pstee: true } },
        { name: "Tint Playing Screen Fade", engines: ["pst"], param1: { label: "RGB Colour" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: false, pst: true, pstee: true } },
    ],
    196: [
        { name: "Spell Effect: Familiar Block", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: false, pst: true, pstee: true } },
        { name: "Unknown", engines: ["iwd1"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: false, pst: true, pstee: true } },
        { name: "Special Effects (Planescape: Torment)", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Effect" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: false, pst: true, pstee: true } },
    ],
    197: [
        { name: "Spell: Bounce (by Impact Projectile)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Impact Projectile" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "*DON'T USE* Projectile Bounce", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Reference Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "None", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    198: [
        { name: "Spell: Bounce (by Opcode)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Opcode" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Spell: Bounce Opcode", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "opcode" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "None", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    199: [
        { name: "Spell: Bounce (by Power Level)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Power Level" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Spell: Bounce Spells", engines: ["iwd2"], param1: { label: "Reflected Level" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "None", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    200: [
        { name: "Spell: Bounce (by Power level, decrementing)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Total Amount" }, param2: { label: "Power Level" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "SPL" },
        { name: "Spell: Decrementing Bounce Spells", engines: ["iwd2"], param1: { label: "Amount" }, param2: { label: "Level" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "None", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    201: [
        { name: "Spell: Immunity (by Power Level, decrementing)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Total Amount" }, param2: { label: "Power Level" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "SPL" },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Special FX", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Effect" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    202: [
        { name: "Spell: Bounce (by School)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "School" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Spell: Bounce Spell School", engines: ["iwd2"], param1: { label: "Undetermined" }, param2: { label: "Spell School" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "None", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    203: [
        { name: "Spell: Bounce (by Secondary Type)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Secondary Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Spell: Bounce Secondary Type", engines: ["iwd2"], param1: { label: "Undetermined" }, param2: { label: "Secondary Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Curse (Non-commulitive)", engines: ["pst"], param1: { label: "Penalty Value" }, param2: { label: "Undetermined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    204: [
        { name: "Spell: Protection (by School)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "School" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Prayer (Non-commulitive)", engines: ["pst"], param1: { label: "Value" }, param2: { label: "Undetermined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    205: [
        { name: "Spell: Protection (by Secondary Type)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Secondary Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Move View to Target", engines: ["pst"], param1: { label: "Speed" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    206: [
        { name: "Spell: Protection from Spell", engines: ["bg2", "bgee", "pstee"], param1: { label: "String Reference" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "SPL" },
        { name: "Spell Effect: Immunity Spell", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Embalm (Non-commulitive)", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Embalming Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    207: [
        { name: "Spell: Bounce (by Resource)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true }, resourceType: "SPL" },
        { name: "Spell: Bounce Specified Spell", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Spell Effect: Stop All Action", engines: ["pst"], param1: { label: "Unknown" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    208: [
        { name: "HP: Minimum Limit", engines: ["bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Minimum Value" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Spell Effect: Fist of Iron", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    209: [
        { name: "Death: Kill 60HP", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Spell Effect: Soul Exodus", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    210: [
        { name: "Spell Effect: Stun 90HP", engines: ["bg2", "bgee", "iwd1", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Spell Effect: Detect Evil (Status)", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    211: [
        { name: "Spell Effect: Imprisonment", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Spell Effect: Induce Hiccups", engines: ["pst"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    212: [
        { name: "Protection: Freedom", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
        { name: "Unknown", engines: ["pst"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: true, pstee: true } },
    ],
    213: [
        { name: "Spell Effect: Maze", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, special: { label: "Icon" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    214: [
        { name: "Spell Effect: Select Spell", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "2DA" },
        { name: "Empty:", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    215: [
        { name: "Graphics: Play 3D Effect", engines: ["bg2", "bgee", "iwd2", "pstee"], param1: { label: "Undetermined" }, param2: { label: "Play where?" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    216: [
        { name: "Spell Effect: Level Drain", engines: ["bg2", "bgee", "iwd2", "pstee"], param1: { label: "Amount" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    217: [
        { name: "Spell Effect: Unconsciousness 20HP", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Wake on damage" }, special: { label: "Icon" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    218: [
        { name: "Protection: Stoneskin", engines: ["bg2", "bgee", "iwd1", "iwd2", "pstee"], param1: { label: "Amount" }, param2: { label: "Use Dice?" }, special: { label: "Icon" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    219: [
        { name: "Stat: AC vs. Creature Type Modifier", engines: ["bg2", "bgee", "pstee"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, idsFileByParam2: { 2: ["EA"], 3: ["GENERAL"], 4: ["RACE"], 5: ["CLASS"], 6: ["SPECIFIC"], 7: ["GENDER"], 8: ["ALIGN", "ALIGNMEN"], 9: ["KIT"] } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    220: [
        { name: "Removal: Remove School", engines: ["bg2", "bgee", "iwd2", "pstee"], param1: { label: "Maximum Level" }, param2: { label: "School" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    221: [
        { name: "Removal: Remove Secondary Type", engines: ["bg2", "bgee", "iwd2", "pstee"], param1: { label: "Maximum Level" }, param2: { label: "Secondary Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    222: [
        { name: "Spell Effect: Teleport Field", engines: ["bg2", "bgee", "iwd2", "pstee"], param1: { label: "Max Range" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    223: [
        { name: "Spell: Immunity (by School, decrementing)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Total Amount" }, param2: { label: "School" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "SPL" },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    224: [
        { name: "Cure: Level Drain (Restoration)", engines: ["bg2", "bgee", "iwd2", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    225: [
        { name: "Spell: Reveal Magic", engines: ["bg2", "bgee", "pstee"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    226: [
        { name: "Spell: Immunity (by Secondary Type, decrementing)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Total Amount" }, param2: { label: "Secondary Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "SPL" },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    227: [
        { name: "Spell: Bounce (by School, decrementing)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Total Amount" }, param2: { label: "School" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "SPL" },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    228: [
        { name: "Spell: Bounce (by Secondary Type, decrementing)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Total Amount" }, param2: { label: "Secondary Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "SPL" },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    229: [
        { name: "Removal: Remove One School", engines: ["bg2", "bgee", "pstee"], param1: { label: "Max Level" }, param2: { label: "School" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    230: [
        { name: "Removal: Remove One Secondary Type", engines: ["bg2", "bgee", "pstee"], param1: { label: "Max Level" }, param2: { label: "Secondary Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    231: [
        { name: "Spell Effect: Time Stop", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty:", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    232: [
        { name: "Spell Effect: Cast Spell on Condition", engines: ["bg2", "bgee", "pstee"], param1: { label: "Target" }, param2: { label: "Condition" }, special: { label: "Extra" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "SPL" },
        { name: "Color Glow Dissipate", engines: ["iwd2"], param1: { label: "RGB Color" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Colour: Fade from Colour RGB", engines: ["iwd1"], param1: { label: "RGB Colour" }, param2: { label: "Location" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    233: [
        { name: "Stat: Proficiency Modifier", engines: ["bg2", "bgee", "pstee"], param1: { label: "Amount" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Graphics: Icewind Visual Spell Hit", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    234: [
        { name: "Spell Effect: Contingency Creation", engines: ["bg2", "bgee", "pstee"], param1: { label: "Maximum Level Usable" }, param2: { label: "Amount/Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "HP: Cold Damage", engines: ["iwd1"], param1: { label: "Damage" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    235: [
        { name: "Spell Effect: Wing Buffet", engines: ["bg2", "bgee", "pstee"], param1: { label: "Speed" }, param2: { label: "Direction" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Graphics: Icewind Casting Glow", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    236: [
        { name: "Spell Effect: Image Projection", engines: ["bg2", "bgee", "pstee"], param1: { label: "Undetermined" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Panic Undead", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Chill Touch", engines: ["iwd1"], param1: { label: "Damage" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    237: [
        { name: "Spell Effect: Puppet ID", engines: ["bg2", "bgee", "pstee"], param1: { label: "Master ID" }, param2: { label: "Image Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "HP: Crushing Damage", engines: ["iwd1"], param1: { label: "Damage" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    238: [
        { name: "Death: Disintegrate", engines: ["bg2", "bgee", "pstee"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, idsFileByParam2: { 2: ["EA"], 3: ["GENERAL"], 4: ["RACE"], 5: ["CLASS"], 6: ["SPECIFIC"], 7: ["GENDER"], 8: ["ALIGN", "ALIGNMEN"], 9: ["KIT"] } },
        { name: "Stat: Save vs. all", engines: ["iwd1", "iwd2"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    239: [
        { name: "Spell Effect: Farsight", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Slow Poison", engines: ["iwd2"], param1: { label: "Slow Factor" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Cure: Slow Poison", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    240: [
        { name: "Graphics: Remove Special Effect Icon", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Icon" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Summon: Icewind Summoning Spell", engines: ["iwd1"], param1: { label: "Creature Number" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    241: [
        { name: "Charm: Control Creature", engines: ["bg2", "bgee", "pstee"], param1: { label: "Creature ID" }, param2: { label: "Charm Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "HP: Vampiric Touch", engines: ["iwd1", "iwd2"], param1: { label: "Damage" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    242: [
        { name: "Cure: Confusion", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Graphics: Display Creature Overlay", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    243: [
        { name: "Item: Drain Item Charges", engines: ["bg2", "bgee", "pstee"], param1: { label: "Amount to Drain" }, param2: { label: "Unused" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "ITM" },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Summon: Icewind Animate Dead", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    244: [
        { name: "Spell: Drain Wizard Spell", engines: ["bg2", "bgee", "pstee"], param1: { label: "Number to Drain" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "State: Prayer", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "State: Positive Prayer", engines: ["iwd1"], param1: { label: "Modifier" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    245: [
        { name: "Check For Berserk", engines: ["bg2", "bgee", "pstee"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "State: Negative Prayer", engines: ["iwd1"], param1: { label: "Modifier" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    246: [
        { name: "Spell Effect: Berserking", engines: ["bg2", "bgee", "pstee"], param1: { label: "Undetermined" }, param2: { label: "Undetermined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Summon: Icewind Summoning Spell (Mixed)", engines: ["iwd1"], param1: { label: "Creature Number" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    247: [
        { name: "Spell Effect: Attack Nearest Creature", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Constant Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Beltyn's Burning Blood", engines: ["iwd1", "iwd2"], param1: { label: "Strikes Number" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    248: [
        { name: "Item: Set Melee Effect", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Fist only" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "EFF" },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Summon: Summon Shadow Monsters", engines: ["iwd1"], param1: { label: "Creature Number" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    249: [
        { name: "Item: Set Ranged Effect", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "EFF" },
        { name: "State: Positive Recitation (state)", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    250: [
        { name: "Spell Effect: Damage Modifier", engines: ["bg2", "bgee", "pstee"], param1: { label: "Damage Modifier" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "State: Negative Recitation", engines: ["iwd1"], param1: { label: "Modifier" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    251: [
        { name: "Spell Effect: Change Bard Song Effect", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "SPL" },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "State: Hold (Lich Touch)", engines: ["iwd1"], param1: { label: "Duration" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    252: [
        { name: "Spell Effect: Set Trap", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "SPL" },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "State: Blinded (Sol's Searing Orb)", engines: ["iwd1"], param1: { label: "Damage" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    253: [
        { name: "Spell Effect: Add Map Marker", engines: ["bg2", "bgee", "pstee"], param1: { label: "String Reference" }, param2: { label: "Marker Color" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Stat: AC vs. Damage Type Modifier (II)", engines: ["iwd1"], param1: { label: "AC Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    254: [
        { name: "Spell Effect: Remove Map Marker", engines: ["bg2", "bgee", "pstee"], param1: { label: "String Reference" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Removal: Effects specified by Resource", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    255: [
        { name: "Item: Create Inventory Item (days)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Charges" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "ITM" },
        { name: "State: Salamander Aura", engines: ["iwd1", "iwd2"], param1: { label: "Damage" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    256: [
        { name: "Spell: Spell Sequencer Active", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Umber Hulk Gaze", engines: ["iwd1", "iwd2"], param1: { label: "Duration" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    257: [
        { name: "Spell: Spell Sequencer Creation", engines: ["bg2", "bgee", "pstee"], param1: { label: "Maximum Level Usable" }, param2: { label: "Amount" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "(Zombie Lord Aura)", engines: ["iwd1"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    258: [
        { name: "Spell: Spell Sequencer Activation", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "SPL" },
        { name: "Protection: Immunity Resource", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    259: [
        { name: "Protection: Spell Trap (by Power Level, decrementing)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Total Amount" }, param2: { label: "Power Level" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "SPL" },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Summon: Summon Creature", engines: ["iwd1"], param1: { label: "Creature Number" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    260: [
        { name: "Spell: Spell Sequencer Activation", engines: ["bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "SPL" },
        { name: "Crash", engines: ["bg2"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Graphics: Animation Removal", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    261: [
        { name: "Spell: Restore Lost Spells", engines: ["bg2", "bgee", "pstee"], param1: { label: "Spell Level" }, param2: { label: "Spell Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Protection: Immunity Effect and Resource", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Opcode" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    262: [
        { name: "Stat: Visual Range", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Summon: Summon Pomabs", engines: ["iwd1"], param1: { label: "Undefined" }, param2: { label: "Undefined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    263: [
        { name: "Stat: Backstab", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Turn Undead (Evil)", engines: ["iwd1", "iwd2"], param1: { label: "General" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    264: [
        { name: "Spell Effect: Drop Weapons in Panic", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Static Charge", engines: ["iwd1", "iwd2"], param1: { label: "Number" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    265: [
        { name: "Script: Modify Global Variable", engines: ["bg2", "bgee", "pstee"], param1: { label: "Value" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "State: Cloak of Fear", engines: ["iwd1", "iwd2"], param1: { label: "Number" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    266: [
        { name: "Spell: Remove Protection from Spell", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "SPL" },
        { name: "Stat: Movement Modifier (forced)", engines: ["iwd1", "iwd2"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    267: [
        { name: "Text: Protection from Display Specific String", engines: ["bg2", "bgee", "pstee"], param1: { label: "String Reference" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Cure: Remove Confusion", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    268: [
        { name: "Spell Effect: Clear Fog of War (Wizard Eye)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Eye of the Mind", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    269: [
        { name: "Spell Effect: Shake Window", engines: ["bg2", "bgee", "pstee"], param1: { label: "Strength" }, param2: { label: "Undetermined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Eye of the Sword", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    270: [
        { name: "Cure: Unpause Target", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Eye of the Mage", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    271: [
        { name: "Graphics: Avatar Removal", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Mode" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Eye of the Venom", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    272: [
        { name: "Spell: Apply Repeating EFF", engines: ["bg2", "bgee", "pstee"], param1: { label: "Amount_1" }, param2: { label: "Type" }, param3: { label: "Amount_2" }, param4: { label: "Frequency Multiplier" }, special: { label: "Icon" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "EFF" },
        { name: "Spell Effect: Eye of the Spirit", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    273: [
        { name: "Remove: Specific Area Effect(Zone of Sweet Air)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Undetermined" }, param2: { label: "Undetermined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, resourceType: "2DA" },
        { name: "Spell Effect: Eye of the Fortitude", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    274: [
        { name: "Spell Effect: Teleport to Target", engines: ["bg2", "bgee", "pstee"], param1: { label: "Undetermined" }, param2: { label: "Undetermined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Eye of the Stone", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    275: [
        { name: "Stat: Hide in Shadows Modifier", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Remove Seven Eyes", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    276: [
        { name: "Stat: Detect Illusion Modifier", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Remove Effects of Type", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Remove Effects of Type", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    277: [
        { name: "Stat: Set Traps Modifier", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "HP: Magic Damage (Soul Eater)", engines: ["iwd1"], param1: { label: "Damage" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    278: [
        { name: "Stat: To Hit Modifier", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Shroud of Flame", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    279: [
        { name: "Button: Enable Button", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Button" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Animal Rage", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    280: [
        { name: "Spell Effect: Wild Magic", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Turn Undead", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    281: [
        { name: "Stat: Wild Magic", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Vitriolic Sphere", engines: ["iwd1", "iwd2"], param1: { label: "Damage" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    282: [
        { name: "Script: Scripting State Modifier", engines: ["bg2", "bgee", "pstee"], param1: { label: "Value" }, param2: { label: "Scripting State" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "HP: Suppress HP Info", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    283: [
        { name: "Use EFF File (Cursed)", engines: ["bg2", "bgee", "pstee"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true }, idsFileByParam2: { 2: ["EA"], 3: ["GENERAL"], 4: ["RACE"], 5: ["CLASS"], 6: ["SPECIFIC"], 7: ["GENDER"], 8: ["ALIGN", "ALIGNMEN"], 9: ["KIT"] } },
        { name: "Text: Float Text", engines: ["iwd1", "iwd2"], param1: { label: "Strref" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    284: [
        { name: "Stat: Melee THAC0 Modifier", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Mace of Disruption", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    285: [
        { name: "Stat: Melee Weapon Damage Modifier", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "State: Sleep (forced)", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    286: [
        { name: "Stat: Missile Weapon Damage Modifier", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Ranger Tracking", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    287: [
        { name: "Graphics: Selection Circle Removal", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Protection: Backstab", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    288: [
        { name: "Stat: Fist THAC0 Modifier", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Set State", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "State: Set State", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    289: [
        { name: "Stat: Fist Damage Modifier", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Empty (will crash)", engines: ["iwd2"], param1: { label: "Irrelenvant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Dragon Gem Cutscene", engines: ["iwd1"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    290: [
        { name: "Text: Change Title", engines: ["bg2", "bgee", "pstee"], param1: { label: "String Reference" }, param2: { label: "Position" }, special: { label: "Class" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Protection: from Spell (Message)", engines: ["iwd1", "iwd2"], param1: { label: "Value" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    291: [
        { name: "Graphics: Disable Visual Effect", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Debian's Rod of Smiting", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    292: [
        { name: "Protection: Backstab", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Magical Rest", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    293: [
        { name: "Script: Enable Offscreen AI", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Beholder Dispel Magic", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    294: [
        { name: "Spell Effect: Existance Delay Override", engines: ["bg2", "bgee", "pstee"], param1: { label: "Undefined" }, param2: { label: "Constant Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Harpy Wail", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    295: [
        { name: "Graphics: Disable Permanent Death", engines: ["bg2", "bgee", "pstee"], param1: { label: "Undefined" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Spell Effect: Jackalwere Gaze", engines: ["iwd1", "iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    296: [
        { name: "Graphics: Protection from Specific Animation", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
        { name: "Script: Set Global Variable", engines: ["iwd1", "iwd2"], param1: { label: "Value" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: true, iwd2: true, pst: false, pstee: true } },
    ],
    297: [
        { name: "Spell Effect: Immunity to Turn Undead", engines: ["bg2", "bgee", "pstee"], param1: { label: "Undefined" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: true, pst: false, pstee: true } },
        { name: "Stat: Hide In Shadows", engines: ["iwd2"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: true, pst: false, pstee: true } },
    ],
    298: [
        { name: "Spell Effect: Execute Script cut250a", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: true, pst: false, pstee: true } },
        { name: "Stat: Use Magic Device", engines: ["iwd2"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: true, pst: false, pstee: true } },
    ],
    299: [
        { name: "Spell Effect: Chaos Shield", engines: ["bg2", "bgee", "pstee"], param1: { label: "Shield Amount" }, param2: { label: "Icon" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    300: [
        { name: "Spell Effect: NPCBump", engines: ["bg2", "bgee", "pstee"], param1: { label: "Unknown" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    301: [
        { name: "Stat: Critical Hit Modifier", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Condition" }, param3: { label: "Weapon Category" }, special: { label: "Attack Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    302: [
        { name: "Item: Can Use Any Item", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    303: [
        { name: "Spell Effect: Backstab Every Hit", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    304: [
        { name: "Mass Raise Dead", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    305: [
        { name: "Stat: THAC0 Modifier (Off-Hand)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    306: [
        { name: "Stat: THAC0 Modifier (On-Hand)", engines: ["bg2", "bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    307: [
        { name: "Ranger Tracking Ability", engines: ["bg2", "bgee", "pstee"], param1: { label: "Range" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    308: [
        { name: "Protection: From Tracking", engines: ["bg2", "bgee", "pstee"], param1: { label: "Radius" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    309: [
        { name: "Script: Modify Local Variable", engines: ["bg2", "bgee", "pstee"], param1: { label: "Value" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    310: [
        { name: "Protection: from Timestop", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    311: [
        { name: "Spell: Random Wish Spell", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    312: [
        { name: "Crash", engines: ["bg2", "bgee", "pstee"], param1: { label: "Undefined" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    313: [
        { name: "High-Level Ability Denotation", engines: ["bg2", "bgee", "pstee"], param1: { label: "Undetermined" }, param2: { label: "Undetermined" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true }, resourceType: "SPL" },
    ],
    314: [
        { name: "Spell: Golem Stoneskin", engines: ["bg2", "bgee", "pstee"], param1: { label: "Amount" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    315: [
        { name: "Graphics: Animation Removal", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    316: [
        { name: "Spell: Magical Rest", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    317: [
        { name: "State: Haste 2", engines: ["bg2", "bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    318: [
        { name: "Protection from Resource", engines: ["bgee", "pstee"], param1: { label: "Value" }, param2: { label: "Stat Type" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
        { name: "Stat: Set Stat (TobEx)", engines: ["bg2"], param1: { label: "Statistic Modifier" }, param2: { label: "Stat Opcode (low word) / Type (high word)" }, availability: { bg1: false, bg2: true, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    319: [
        { name: "Usability: Item Usability", engines: ["bgee", "pstee"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, special: { label: "Description note" }, power: { label: "Usability behavior" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true }, idsFileByParam2: { 2: ["EA"], 3: ["GENERAL"], 4: ["RACE"], 5: ["CLASS"], 6: ["SPECIFIC"], 7: ["GENDER"], 8: ["ALIGN", "ALIGNMEN"], 9: ["KIT"] } },
    ],
    320: [
        { name: "Change Weather", engines: ["bgee", "pstee"], param1: { label: "Weather" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    321: [
        { name: "Removal: Effects specified by Resource", engines: ["bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    322: [
        { name: "Evade Area of Effect", engines: ["bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    323: [
        { name: "Stat: Turn Undead Level", engines: ["bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, special: { label: "Mode" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    324: [
        { name: "Protection: Immunity to Resource and Message", engines: ["bgee", "pstee"], param1: { label: "Value" }, param2: { label: "Stat Type" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    325: [
        { name: "Stat: Save vs. all", engines: ["bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    326: [
        { name: "Apply Effects List", engines: ["bgee", "pstee"], param1: { label: "Value" }, param2: { label: "Stat Type" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true }, resourceType: "SPL" },
    ],
    327: [
        { name: "Graphics: Icewind Visual Spell Hit (plays sound)", engines: ["bgee", "pstee"], param1: { label: "Target" }, param2: { label: "Projectile Index" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    328: [
        { name: "State: Set Extended or Spell State", engines: ["bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, special: { label: "Mode" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    329: [
        { name: "Spell Effect: Slow Poison", engines: ["bgee", "pstee"], param1: { label: "Slow Factor" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    330: [
        { name: "Text: Float Text", engines: ["bgee", "pstee"], param1: { label: "Strref" }, param2: { label: "Type" }, param3: { label: "Starting strref" }, special: { label: "Count" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    331: [
        { name: "Summon: Random Monster Summoning", engines: ["bgee", "pstee"], param1: { label: "Count" }, param2: { label: "Type" }, special: { label: "Mode" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true }, resourceType: "2DA" },
    ],
    332: [
        { name: "Stat: Specific Damage Modifier", engines: ["bgee", "pstee"], param1: { label: "Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    333: [
        { name: "Spell Effect: Static Charge", engines: ["bgee", "pstee"], param1: { label: "Number" }, param2: { label: "Level" }, special: { label: "Delay" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true }, resourceType: "SPL" },
    ],
    334: [
        { name: "Spell Effect: Turn Undead", engines: ["bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    335: [
        { name: "Spell Effect: Seven Eyes", engines: ["bgee", "pstee"], param1: { label: "Spellstate" }, param2: { label: "Row#" }, special: { label: "Eye Group" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true }, resourceType: "SPL" },
    ],
    336: [
        { name: "Graphics: Display Eyes Overlay", engines: ["bgee", "pstee"], param1: { label: "Sequence" }, param2: { label: "Eye Group" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true }, resourceType: "BAM" },
    ],
    337: [
        { name: "Remove: Opcode", engines: ["bgee", "pstee"], param1: { label: "Param" }, param2: { label: "Opcode" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    338: [
        { name: "Disable Rest", engines: ["bgee", "pstee"], param1: { label: "StrRef" }, param2: { label: "Mode" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    339: [
        { name: "Alter Animation", engines: ["bgee", "pstee"], param1: { label: "Value and Modifier" }, param2: { label: "Projectile Type" }, special: { label: "Range" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    340: [
        { name: "Spell Effect: Change Backstab Effect", engines: ["bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true }, resourceType: "SPL" },
    ],
    341: [
        { name: "Spell Effect: Change Critical Hit Effect", engines: ["bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Condition" }, param3: { label: "Weapon Category" }, special: { label: "Attack Type" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true }, resourceType: "SPL" },
    ],
    342: [
        { name: "Animation: Override Data", engines: ["bgee", "pstee"], param1: { label: "Value" }, param2: { label: "Field" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    343: [
        { name: "HP Swap", engines: ["bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Mode" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    344: [
        { name: "Enchantment vs. creature type", engines: ["bgee", "pstee"], param1: { label: "IDS Entry" }, param2: { label: "IDS File" }, param3: { label: "Weapon Slot" }, param4: { label: "Weapon Category" }, special: { label: "Enchantment Level" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true }, idsFileByParam2: { 2: ["EA"], 3: ["GENERAL"], 4: ["RACE"], 5: ["CLASS"], 6: ["SPECIFIC"], 7: ["GENDER"], 8: ["ALIGN", "ALIGNMEN"], 9: ["KIT"] } },
    ],
    345: [
        { name: "Enchantment bonus", engines: ["bgee", "pstee"], param1: { label: "Enchantment Level" }, param2: { label: "Type" }, special: { label: "Weapon Slot" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    346: [
        { name: "Save vs. school bonus", engines: ["bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, special: { label: "Primary Type" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    347: [
        { name: "Unused", engines: ["bgee"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
        { name: "Move View to Target", engines: ["pstee"], param1: { label: "Scroll Speed" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    348: [
        { name: "Unused", engines: ["bgee"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
        { name: "Cloak of Warding (Non-cumulative)", engines: ["pstee"], param1: { label: "Base amount" }, param2: { label: "Amount per level" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    349: [
        { name: "Unused", engines: ["bgee"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
        { name: "Pain Mirror (Non-cumulative)", engines: ["pstee"], param1: { label: "# damage effects to reflect" }, param2: { label: "Unused" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    350: [
        { name: "Unused", engines: ["bgee"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
        { name: "Guardian Mantle (Non-cumulative)", engines: ["pstee"], param1: { label: "Enabled?" }, param2: { label: "Unused" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    351: [
        { name: "Unused", engines: ["bgee"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
        { name: "Armor (Non-cumulative)", engines: ["pstee"], param1: { label: "Amount" }, param2: { label: "Add caster level bonus?" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    352: [
        { name: "Unused", engines: ["bgee"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
        { name: "Change Background", engines: ["pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    353: [
        { name: "Unused", engines: ["bgee"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
        { name: "Tint Playing Screen Fade", engines: ["pstee"], param1: { label: "RGB Colour" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    354: [
        { name: "Unused", engines: ["bgee"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
        { name: "Flash Playing Screen", engines: ["pstee"], param1: { label: "Unused" }, param2: { label: "Unused" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    355: [
        { name: "Unused", engines: ["bgee"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
        { name: "Spell Effect: Soul Exodus", engines: ["pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    356: [
        { name: "Unused", engines: ["bgee"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
        { name: "Spell Effect: Stop All Action", engines: ["pstee"], param1: { label: "Unknown" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    357: [
        { name: "Unused", engines: ["bgee"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
        { name: "State: Set State", engines: ["pstee"], param1: { label: "Action" }, param2: { label: "State" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    358: [
        { name: "Unused", engines: ["bgee"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
        { name: "Incite Berserk Attack", engines: ["pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    359: [
        { name: "Unused", engines: ["bgee", "pstee"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    360: [
        { name: "Stat: Ignore Reputation Breaking Point", engines: ["bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    361: [
        { name: "Cast spell on critical miss", engines: ["bgee", "pstee"], param1: { label: "Unused" }, param2: { label: "Current Weapon Only?" }, param3: { label: "Weapon Category" }, special: { label: "Attack Type" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true }, resourceType: "SPL" },
    ],
    362: [
        { name: "Critical miss bonus", engines: ["bgee", "pstee"], param1: { label: "Statistic Modifier" }, param2: { label: "Current Weapon Only?" }, param3: { label: "Weapon Category" }, special: { label: "Attack Type" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    363: [
        { name: "Modal state check", engines: ["bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, special: { label: "Modal State" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    364: [
        { name: "Empty", engines: ["bgee", "pstee"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    365: [
        { name: "Make unselectable", engines: ["bgee", "pstee"], param1: { label: "Dialogue enabled" }, param2: { label: "AI enabled" }, special: { label: "Selection circle color" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    366: [
        { name: "Spell: Apply Spell On Move", engines: ["bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true }, resourceType: "SPL" },
    ],
    367: [
        { name: "Minimum base stats", engines: ["bgee", "pstee"], param1: { label: "Irrelevant" }, param2: { label: "Stat Value" }, availability: { bg1: false, bg2: false, bgee: true, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    368: [
        { name: "Play BAM with expiration effect", engines: ["pstee"], param1: { label: "Irrelevant" }, param2: { label: "Flags" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    369: [
        { name: "Play BAM File Blended and Sticky", engines: ["pstee"], param1: { label: "RGB" }, param2: { label: "Method" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    370: [
        { name: "Play BAM file", engines: ["pstee"], param1: { label: "RGB" }, param2: { label: "Method" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    371: [
        { name: "Play BAM file", engines: ["pstee"], param1: { label: "RGB" }, param2: { label: "Method" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    372: [
        { name: "Play BAM file", engines: ["pstee"], param1: { label: "RGB" }, param2: { label: "Method" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    373: [
        { name: "Play BAM file", engines: ["pstee"], param1: { label: "RGB" }, param2: { label: "Method" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    374: [
        { name: "Special spell hit", engines: ["pstee"], param1: { label: "Irrelevant" }, param2: { label: "Effect" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    375: [
        { name: "Play BAM with effects", engines: ["pstee"], param1: { label: "Irrelevant" }, param2: { label: "Effect" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    376: [
        { name: "Spell Effect: Detect Evil", engines: ["pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    377: [
        { name: "Speak with Dead", engines: ["pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    378: [
        { name: "Prayer (Non-cumulative)", engines: ["pstee"], param1: { label: "Value" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    379: [
        { name: "Curse (Non-cumulative)", engines: ["pstee"], param1: { label: "Value" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    380: [
        { name: "Embalm (Non-cumulative)", engines: ["pstee"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    381: [
        { name: "Induce Hiccups", engines: ["pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    382: [
        { name: "Fist of Iron", engines: ["pstee"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    383: [
        { name: "Hit Point Transfer", engines: ["pstee"], param1: { label: "Drain Amount" }, param2: { label: "Drain Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: false, pst: false, pstee: true } },
    ],
    400: [
        { name: "State: Hopelessness", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    401: [
        { name: "State: Protection from Evil", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    402: [
        { name: "Add Effects List", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    403: [
        { name: "State: Armor of Faith", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    404: [
        { name: "State: Nausea", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    405: [
        { name: "State: Enfeeblement", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    406: [
        { name: "State: Fireshield", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    407: [
        { name: "State: Death Ward", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    408: [
        { name: "State: Holy Power", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    409: [
        { name: "State: Righteous Wrath of the Faithful", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    410: [
        { name: "Summon (as ally)", engines: ["iwd2"], param1: { label: "Number" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    411: [
        { name: "Summon (as enemy)", engines: ["iwd2"], param1: { label: "Number" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    412: [
        { name: "State: Control", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    413: [
        { name: "Icewind Visual Effect", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    414: [
        { name: "State: Otiluke's Resilient Sphere", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    415: [
        { name: "State: Barkskin", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    416: [
        { name: "State: Bleeding Wounds", engines: ["iwd2"], param1: { label: "Amount" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    417: [
        { name: "Area Effect Using Effects List", engines: ["iwd2"], param1: { label: "Radius" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    418: [
        { name: "State: Free Action", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    419: [
        { name: "State: Unconsciousness", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    420: [
        { name: "Spell Effect: Death Magic", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    421: [
        { name: "State: Entropy Shield", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    422: [
        { name: "State: Storm Shell", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    423: [
        { name: "State: Protection from the Elements", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    424: [
        { name: "State: Hold Undead", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    425: [
        { name: "State: Control Undead", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    426: [
        { name: "State: Aegis", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    427: [
        { name: "State: Executioner's Eyes", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    428: [
        { name: "Banish", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    429: [
        { name: "When Struck Using Effects List", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    430: [
        { name: "Projectile Type Using Effects List", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    431: [
        { name: "State: Energy Drain", engines: ["iwd2"], param1: { label: "Value" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    432: [
        { name: "State: Tortoise Shell", engines: ["iwd2"], param1: { label: "Value" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    433: [
        { name: "State: Blink", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    434: [
        { name: "Persistant Using Effects List", engines: ["iwd2"], param1: { label: "Value" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    435: [
        { name: "Spell Effect: Day Blindness", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    436: [
        { name: "Spell Effect: Damage Reduction", engines: ["iwd2"], param1: { label: "Damage" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    437: [
        { name: "Disguise", engines: ["iwd2"], param1: { label: "Value" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    438: [
        { name: "Spell Effect: Heroic Inspiration", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    439: [
        { name: "Script: Prevent AI Slow Down 439]", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    440: [
        { name: "Spell Effect: Babarian Rage", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    441: [
        { name: "Stat: Movement Modifier", engines: ["iwd2"], param1: { label: "Statistic Modifier" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    442: [
        { name: "Feat: Cleave", engines: ["iwd2"], param1: { label: "Unknown" }, param2: { label: "Unknown" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    443: [
        { name: "State: Protection from Arrows", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    444: [
        { name: "State: Tenser's Transformation", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    445: [
        { name: "Charm: Slippery Mind", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    446: [
        { name: "Spell Effect: Smite Evil", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    447: [
        { name: "Cure: Restoration", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    448: [
        { name: "Spell Effect: Alicorn Lance Glow", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    449: [
        { name: "Spell Effect: Call Lightning", engines: ["iwd2"], param1: { label: "Amount" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    450: [
        { name: "State: Globe of Invulnerability", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    451: [
        { name: "State: Lower Resistance", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    452: [
        { name: "State: Bane", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Type" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    453: [
        { name: "Spell Effect: Power Attack", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    454: [
        { name: "Spell Effect: Expertise", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    455: [
        { name: "Spell Effect: Arterial Strike", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    456: [
        { name: "Spell Effect: Hamstring", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
    457: [
        { name: "Spell Effect: Rapid Shot", engines: ["iwd2"], param1: { label: "Irrelevant" }, param2: { label: "Irrelevant" }, availability: { bg1: false, bg2: false, bgee: false, iwd1: false, iwd2: true, pst: false, pstee: false } },
    ],
};
