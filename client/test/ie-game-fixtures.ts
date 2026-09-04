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
// `import type`, not `import { type ... }`: under verbatimModuleSyntax the latter still emits the import,
// which loads `creature-index`'s module graph and with it `vscode`, unavailable outside the extension host.
import type { GameHandle } from "../src/ie-resources/creature-index";

/** Which real resource each fixture row was copied from. Read this before changing any value here. */
export const MINI_GAME_PROVENANCE = {
    "ANISND.IDS":
        "verbatim rows of an EE install's ANISND.IDS - including a FEMALE row, without which a\n        gender defect cannot fail against this fixture",
    "ANIMATE.IDS": "verbatim, including the two ids ANISND.IDS does not name",
    "6000.INI": "cleric male human - the armour-family split (body CHMB, level 4 CHMC)",
    "6004.INI": "cleric male gnome - the aliasing case (body CDMB, paperdoll CGMC)",
    "A000.INI": "wyvern - a hex animation_type and a scheme with no implementation",
    bams: "presence checked against an EE install: CHMB1G1 exists, CHMB4G1 does not, CHMC4G1 does",
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
    "CGMC4G1",
    "CGMC1INV",
    "CHMM1G1",
    "MWYVG1",
];

const TEXT: Record<string, string> = {
    "ANISND.ids": ANISND,
    "ANIMATE.ids": ANIMATE,
    "6000.ini": INI_6000,
    "6004.ini": INI_6004,
    "A000.ini": INI_A000,
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
