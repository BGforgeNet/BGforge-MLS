/**
 * Curated param value tables for opcodes whose IESDP body enum is not auto-parseable.
 * Each entry is merged over the harvested labels: enums here win; labels fall back to
 * the frontmatter label when the override does not specify one.
 *
 * All values verified against the corresponding external/infinity-engine/iesdp/_opcodes/op<NNN>.html.
 */

import type { OpcodeRelationship } from "./extract-opcodes.ts";

export const OpcodeRelationshipOverrides: Readonly<Record<number, OpcodeRelationship>> = {
    // op000: AC vs Damage Type Modifier
    // Verified from op000.html body <ul> block.
    0: {
        param2: {
            enum: {
                0: "All",
                1: "Crushing",
                2: "Missile",
                4: "Piercing",
                8: "Slashing",
                16: "Base AC Setting",
            },
        },
    },

    // op001: Attacks Per Round Modifier
    // Verified from op001.html body text: "Known values for 'Type' are".
    1: {
        param2: {
            enum: {
                0: "Cumulative Modifier",
                1: "Flat Value Modifier",
                2: "Percentage Modifier",
                3: "Cumulative Modifier",
            },
        },
    },

    // op003: State Berserking
    // Verified from op003.html body <ul> block.
    3: {
        param2: {
            enum: {
                0: "Default/In Combat",
                1: "Constant",
                2: "Blood Rage",
            },
        },
    },

    // op019: Stat: Intelligence Modifier (representative of the Cumulative/Flat/Percentage
    // stat modifier pattern used by many stat opcodes; values from op019.html body <ul>).
    19: {
        param2: {
            enum: {
                0: "Cumulative Modifier",
                1: "Flat Value Modifier",
                2: "Percentage Modifier",
            },
        },
    },

    // op025: State: Poison
    // Verified from op025.html body text: "Known values for 'Type' are".
    25: {
        param2: {
            enum: {
                0: "1 HP per second (nonzero amount)",
                1: "1 HP per second (amount > 1)",
                2: "Damage Amount per second",
                3: "1 HP every Damage Amount seconds",
            },
        },
    },

    // op039: State: Unconsciousness
    // Verified from op039.html body <ul> block.
    39: {
        param2: {
            enum: {
                0: "Yes",
                1: "No",
            },
        },
    },

    // The IDS-Entry / IDS-File opcodes: parameter1 is an entry in a table parameter2 names. IESDP writes the
    // list several different ways across them ("N -> EA.IDS", "N -> EA", "N   EA.ids"), and the mapping is
    // NOT shared - so each is transcribed from its own page rather than harvested or copied sideways. ALIGN is
    // listed with ALIGNMEN behind it wherever IESDP names either: the two are the same table under the name a
    // given edition ships, which is what the candidate ordering is for.

    // op055: Death: Kill Creature Type
    // Verified from op055.html body text: "Known values for IDS File are".
    55: {
        idsFileByParam2: {
            2: ["EA"],
            3: ["GENERAL"],
            4: ["RACE"],
            5: ["CLASS"],
            6: ["SPECIFIC"],
            7: ["GENDER"],
            8: ["ALIGN", "ALIGNMEN"],
            9: ["KIT"], // EE only
        },
    },

    // op072: Creature Type: Change
    // Verified from op072.html body text. This one is 0-BASED, unlike every other opcode here.
    72: {
        idsFileByParam2: {
            0: ["EA"],
            1: ["GENERAL"],
            2: ["RACE"],
            3: ["CLASS"],
            4: ["SPECIFIC"],
            5: ["GENDER"],
            6: ["ALIGN", "ALIGNMEN"],
        },
    },

    // op100: Protection: Creature Type
    // Verified from op100.html body text: "Known values for IDS File are". Same mapping as op055; IESDP notes
    // its slot 9 (KIT) is broken in at least engine 2.5, which is engine behaviour, not a naming difference.
    100: {
        idsFileByParam2: {
            2: ["EA"],
            3: ["GENERAL"],
            4: ["RACE"],
            5: ["CLASS"],
            6: ["SPECIFIC"],
            7: ["GENDER"],
            8: ["ALIGN", "ALIGNMEN"],
            9: ["KIT"],
        },
    },

    // op175: State: Hold
    // Verified from op175.html body text: "Known values for 'IDS File' are". No KIT slot.
    175: {
        idsFileByParam2: {
            2: ["EA"],
            3: ["GENERAL"],
            4: ["RACE"],
            5: ["CLASS"],
            6: ["SPECIFIC"],
            7: ["GENDER"],
            8: ["ALIGN", "ALIGNMEN"],
        },
    },

    // op178: Spell Effect: THAC0 vs. Creature Type Modifier
    // Verified from op178.html body text. Slot 2 is OBJECT here, not EA, and the list stops at GENDER.
    178: {
        idsFileByParam2: {
            2: ["OBJECT"],
            3: ["GENERAL"],
            4: ["RACE"],
            5: ["CLASS"],
            6: ["SPECIFIC"],
            7: ["GENDER"],
        },
    },

    // The nine below document the same pair but sit on pages the old unsuffixed-filename-only harvest never
    // read. They carry the bulk of the real usage - opcode 177 alone occurs an order of magnitude more often
    // across BG:EE and BG2:ToB than all five entries above together. Each is still transcribed from its own
    // page: they happen to agree today, which is not a reason to share one list.

    // op109: State: Hold
    // Verified from op109-bgee.html body text: "Known values for 'IDS File' are".
    109: {
        idsFileByParam2: {
            2: ["EA"],
            3: ["GENERAL"],
            4: ["RACE"],
            5: ["CLASS"],
            6: ["SPECIFIC"],
            7: ["GENDER"],
            8: ["ALIGN", "ALIGNMEN"],
            9: ["KIT"],
        },
    },

    // op177: Use EFF File
    // Verified from op177-bg2.html and op177-bgee.html. The bg2 list stops at ALIGN and the bgee one adds KIT,
    // the same EE-only trailing slot op055 carries.
    177: {
        idsFileByParam2: {
            2: ["EA"],
            3: ["GENERAL"],
            4: ["RACE"],
            5: ["CLASS"],
            6: ["SPECIFIC"],
            7: ["GENDER"],
            8: ["ALIGN", "ALIGNMEN"],
            9: ["KIT"], // EE only
        },
    },

    // op179: Spell Effect: Damage vs. Creature Type Modifier
    // Verified from op179-bgee.html.
    179: {
        idsFileByParam2: {
            2: ["EA"],
            3: ["GENERAL"],
            4: ["RACE"],
            5: ["CLASS"],
            6: ["SPECIFIC"],
            7: ["GENDER"],
            8: ["ALIGN", "ALIGNMEN"],
            9: ["KIT"],
        },
    },

    // op185: State: Hold (II)
    // Verified from op185-bgee.html.
    185: {
        idsFileByParam2: {
            2: ["EA"],
            3: ["GENERAL"],
            4: ["RACE"],
            5: ["CLASS"],
            6: ["SPECIFIC"],
            7: ["GENDER"],
            8: ["ALIGN", "ALIGNMEN"],
            9: ["KIT"],
        },
    },

    // op219: Stat: AC vs. Creature Type Modifier
    // Verified from op219-bg2.html.
    219: {
        idsFileByParam2: {
            2: ["EA"],
            3: ["GENERAL"],
            4: ["RACE"],
            5: ["CLASS"],
            6: ["SPECIFIC"],
            7: ["GENDER"],
            8: ["ALIGN", "ALIGNMEN"],
            9: ["KIT"],
        },
    },

    // op238: Death: Disintegrate
    // Verified from op238-bg2.html. Icewind Dale reads this number as "Stat: Save vs. all" instead, which is
    // why the entry is safe only because the tables describe the BG(2)EE reading - see ENGINE_PREFERENCE.
    238: {
        idsFileByParam2: {
            2: ["EA"],
            3: ["GENERAL"],
            4: ["RACE"],
            5: ["CLASS"],
            6: ["SPECIFIC"],
            7: ["GENDER"],
            8: ["ALIGN", "ALIGNMEN"],
            9: ["KIT"],
        },
    },

    // op283: Use EFF File (Cursed)
    // Verified from op283-bgee.html. Same engine-split caveat as op238: Icewind Dale reads 283 as Float Text.
    283: {
        idsFileByParam2: {
            2: ["EA"],
            3: ["GENERAL"],
            4: ["RACE"],
            5: ["CLASS"],
            6: ["SPECIFIC"],
            7: ["GENDER"],
            8: ["ALIGN", "ALIGNMEN"],
            9: ["KIT"],
        },
    },

    // op319: Usability: Item Usability
    // Verified from op319-bgee.html.
    319: {
        idsFileByParam2: {
            2: ["EA"],
            3: ["GENERAL"],
            4: ["RACE"],
            5: ["CLASS"],
            6: ["SPECIFIC"],
            7: ["GENDER"],
            8: ["ALIGN", "ALIGNMEN"],
            9: ["KIT"],
        },
    },

    // op344: Enchantment vs. creature type
    // Verified from op344-bgee.html.
    344: {
        idsFileByParam2: {
            2: ["EA"],
            3: ["GENERAL"],
            4: ["RACE"],
            5: ["CLASS"],
            6: ["SPECIFIC"],
            7: ["GENDER"],
            8: ["ALIGN", "ALIGNMEN"],
            9: ["KIT"],
        },
    },
};
