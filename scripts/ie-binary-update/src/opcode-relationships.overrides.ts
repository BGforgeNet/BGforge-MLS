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
};
