/**
 * A miniature IE install, served through the structural handle the resource indexes consume.
 *
 * A real install cannot be committed, which is the one case that earns a synthetic fixture - so the risk
 * moves to whether the fixture is honest, and every value below is transcribed from a real install rather
 * than composed. The provenance table in `MINI_GAME_PROVENANCE` records which file each row came from; a
 * plausible invention would pass every mechanism test while encoding a fiction, because those tests assert
 * machinery rather than fidelity.
 *
 * It deliberately carries the shapes that a single-source model gets wrong: a hex `animation_type` that is
 * not digits, a body prefix that changes between armour levels, a set whose paperdoll aliases away from its
 * body, an id one table names and the other does not, and a scheme with no implementation.
 */
import { type Facing } from "@bgforge/image";
import type { GameHandle } from "../src/game-handle";
import { type AnimationSet } from "../src/animation-index";
import { type NeutralAction, type NeutralSet } from "../src/neutral/model";
import { readNeutralSet } from "../src/neutral/read";
import { type StanceIo } from "../src/set-stances";
import { decodeActionCode } from "../src/animation-schemes/actions";
import { bandedPair } from "../../image/test/bam-fixtures.ts";

/** Which real resource each fixture row was copied from. Read this before changing any value here. */
export const MINI_GAME_PROVENANCE = {
    "ANISND.IDS":
        "verbatim rows of an EE install's ANISND.IDS - including a FEMALE row, without which a\n        gender defect cannot fail against this fixture",
    "ANIMATE.IDS": "verbatim, including the two ids ANISND.IDS does not name",
    "6000.INI": "cleric male human - the armour-family split (body CHMB, level 4 CHMC)",
    "6004.INI": "cleric male gnome - the aliasing case (body CDMB, paperdoll CGMC)",
    "A000.INI": "wyvern - a hex animation_type and a scheme with no implementation",
    bams:
        "presence checked against an EE install: CHMB1G1 exists, CHMB4G1 does not, CHMC4G1 does. The gnome " +
        "cleric draws CDMB1-3 and CDMC4 - only its PAPERDOLL is CGMC1INV, and CGMC4G1 does not exist.",
} as const;

const ANISND = `IDS
0x1000 MWYV     CGAMEANIMATIONTYPE_WYVERN_BIG
0x6000 CHMC     CGAMEANIMATIONTYPE_CLERIC_MALE_HUMAN
0x6004 CGMC     CGAMEANIMATIONTYPE_CLERIC_MALE_GNOME
0x6005 COMC     CGAMEANIMATIONTYPE_CLERIC_MALE_HALFORC
0x6010 CHFC     CGAMEANIMATIONTYPE_CLERIC_FEMALE_HUMAN
0x6500 CHMM     CGAMEANIMATIONTYPE_MONK_MALE_HUMAN
0xA000 MWYV     CGAMEANIMATIONTYPE_WYVERN
`;

// 0xE440 is named here and not in ANISND.IDS - the id an index built from one table alone would miss.
const ANIMATE = `IDS
0x1000 WYVERN_BIG
0x6000 CLERIC_MALE_HUMAN
0x6004 CLERIC_MALE_GNOME
0x6005 CLERIC_MALE_HALFORC
0x6010 CLERIC_FEMALE_HUMAN
0x6500 MONK_MALE_HUMAN
0xA000 WYVERN
0xE440 MKHIIN
`;

const INI_6000 = `// CHMC cleric_male_human

[general]
animation_type=6000
ellipse=16

[character]
armor_max_code=4
split_bams=1
false_color=1
resref=CHMB
resref_paperdoll=CHMC
resref_armor_base=B
resref_armor_specific=C
`;

const INI_6004 = `// CGMC cleric_male_gnome

[general]
animation_type=6000
ellipse=16

[character]
armor_max_code=4
split_bams=1
false_color=1
resref=CDMB
resref_paperdoll=CGMC
resref_armor_base=B
resref_armor_specific=C
`;

/** The spell-layered family: its weapon overlay is a second set of files under a declared letter. */
const INI_2200 = `// MOGM ogre_mage

[general]
animation_type=2000
ellipse=16

[monster_layered]
false_color=1
resref=MOGM
resref_weapon1=S1
resref_weapon2=
`;

/** A tiled animation that declares no smooth path, so its sixteen slots hold eight pictures. */
const INI_1100 = `// MTAN tanarri

[general]
animation_type=1000
ellipse=16

[monster_quadrant]
false_color=0
path_smooth=0
quadrants=4
resref=MTAN
`;

const INI_A000 = `// MWYV wyvern

[general]
animation_type=a000
ellipse=16

[monster_large16]
false_color=0
resref=MWYV
`;

/**
 * The BAM names the fixture install "contains".
 *
 * The absence of `CHMB4G1` is load-bearing, not an oversight: the level-4 file is `CHMC4G1`, and a
 * resolver that composes one prefix with every armour level names a file no install ships.
 */
const BAMS = [
    "CHMB1G1",
    "CHMB2G1",
    "CHMB3G1",
    "CHMC4G1",
    "CHMB1SA",
    "CHMC4SA",
    "CHMB1CA",
    "CHMC4CA",
    "CHMC1INV",
    "CHMC2INV",
    "CHMC3INV",
    "CHMC4INV",
    "CDMB1G1",
    "CDMB2G1",
    "CDMB3G1",
    "CDMC4G1",
    "CGMC1INV",
    "CHMM1G1",
    "MWYVG1",
    "MOGMG1",
    "MOGMSG1",
    "MTANG11",
];

const TEXT: Record<string, string> = {
    "ANISND.ids": ANISND,
    "ANIMATE.ids": ANIMATE,
    "6000.ini": INI_6000,
    "6004.ini": INI_6004,
    "A000.ini": INI_A000,
    "2200.ini": INI_2200,
    "1100.ini": INI_1100,
};

const key = (resref: string, type: string): string => `${resref.toUpperCase()}.${type.toLowerCase()}`;

/**
 * The fixture install as a `GameHandle`.
 *
 * Loose values rather than a KEY/BIF archive: the archive layer has its own tests, and this interface is
 * the seam the indexes actually consume.
 */
export function miniGame(): GameHandle {
    return {
        // Enhanced Edition, because this fixture ships animation INIs: a classic flavour here would also
        // hand the index a vendored table, and the cases about an undeclared id would stop being about one.
        identity: { flavour: "bg2ee" },
        tlk: () => undefined,
        canRead: (resref, type) => key(resref, type) in TEXT,
        read: (resref, type) => {
            const text = TEXT[key(resref, type)];
            if (text === undefined) throw new Error(`mini game has no ${key(resref, type)}`);
            return new TextEncoder().encode(text);
        },
        list: () => [
            ...Object.keys(TEXT).map((name) => ({
                resref: name.split(".")[0]!,
                ext: name.split(".")[1]!,
            })),
            ...BAMS.map((resref) => ({ resref, ext: "bam" })),
        ],
    };
}

/** The gnome cleric declaration the conversion suites build their test sets from. */
export const CLERIC_MALE_GNOME_SET: AnimationSet = {
    id: 0x6004,
    code: "CGMC",
    name: "CLERIC_MALE_GNOME",
    prefixByArmour: new Map([[1, "CDMB"]]),
    paperdollPrefix: undefined,
    scheme: { kind: "character" },
    section: "character",
};

/**
 * A parsed gnome cleric set, walking, with its variant's actions replaced by the ones given.
 *
 * The planner and notes suites read the interpretation rather than the pixels, so this keeps one genuinely
 * parsed file underneath while varying the actions - a set whose files map was empty would not be a set.
 */
export function setWithActions(actions: NeutralAction[]): NeutralSet {
    const files: Record<string, Uint8Array> = { CDMB1G1: bandedPair(4, [0, 1, 2, 3, 4]) };
    const io: StanceIo = { exists: (resref) => resref in files, read: (resref) => files[resref] };
    const read = readNeutralSet(CLERIC_MALE_GNOME_SET, io, { flavour: "tob" });
    return { ...read, variants: [{ ...read.variants[0]!, actions }] };
}

/** One directional action storing exactly the facings named, under the given code (default `G1`). */
export function directional(label: string, facings: Facing[], code = "G1"): NeutralAction {
    return {
        label,
        action: decodeActionCode("character", code),
        resrefs: ["CDMB1G1"],
        band: 0,
        cycles: { kind: "directional", directions: facings.map((facing, at) => ({ facing, sequenceIndex: at })) },
    };
}
