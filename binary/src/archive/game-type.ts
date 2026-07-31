/**
 * Infinity Engine game identity. The coarse `variant`/`scriptStyle`/`edition` follow WeiDU's
 * `autodetect_game_type` (KEY marker probe, last match wins) and drive TLK encoding. The finer `flavour` follows
 * the area markers WeiDU's `GAME_IS` tests - e.g. Throne of Bhaal vs Shadows of Amn - and is
 * what `label`/`shortLabel` describe. `detectGameIdentity` reads the KEY (biffed base markers); a separate
 * `refineGameFlavour` pass then upgrades the flavour for conversions/expansions that show only against the live
 * game - EET, SoD, BGT - via override resources and loose files.
 */

import { type KeyIndex } from "./key";

export type IeVariant = "bgee" | "bg2ee" | "pstee" | "iwdee" | "generic";
export type IeScriptStyle = "bg1" | "bg2" | "iwd1" | "iwd2" | "pst";
export type IeFlavour =
    | "bg1"
    | "totsc"
    | "bg2"
    | "tob"
    | "bgt"
    | "iwd"
    | "how"
    | "totlm"
    | "iwd2"
    | "pst"
    | "bgee"
    | "sod"
    | "bg2ee"
    | "iwdee"
    | "pstee"
    | "eet";

export interface GameIdentity {
    readonly variant: IeVariant;
    readonly scriptStyle: IeScriptStyle;
    readonly edition: "classic" | "ee";
    /** Fine WeiDU GAME_IS flavour, e.g. "tob", "totsc", "bgee". */
    readonly flavour: IeFlavour;
    /** Human label, e.g. "Baldur's Gate II: Throne of Bhaal". */
    readonly label: string;
    /** Compact label for tight UI (a view title), e.g. "BG2: ToB", "BGEE". */
    readonly shortLabel: string;
}

const ARE = 0x03f2;
const TDA = 0x03f4;

// Coarse type/script-style (WeiDU autodetect_game_type), last match wins. resType codes (IESDP):
// IDS 0x03f0, MVE 0x0002, ARE 0x03f2, 2DA 0x03f4.
const COARSE_TESTS: readonly (readonly [string, number, IeVariant, IeScriptStyle])[] = [
    ["SUBRACE", 0x03f0, "generic", "iwd2"],
    ["BONES", 0x03f0, "generic", "pst"],
    ["CLOWNRAN", 0x03f0, "generic", "iwd1"],
    ["FLYTHR01", 0x0002, "generic", "bg2"],
    ["OH1000", ARE, "bgee", "bg2"],
    ["OH6000", ARE, "bg2ee", "bg2"],
    ["PSTCHAR", TDA, "pstee", "bg2"],
    ["HOWPARTY", TDA, "iwdee", "bg2"],
];

// Fine flavour by an area/table marker (the set WeiDU's `GAME_IS` tests), MOST SPECIFIC FIRST - a ToB install also
// has the SoA marker, TotSC also has BG1, TotLM also has HoW/IWD - so the expansion is listed before its base,
// and the distinctly-marked EE variants come first. First present marker wins.
const FLAVOUR_MARKERS: readonly (readonly [IeFlavour, string, number])[] = [
    ["pstee", "PSTCHAR", TDA],
    ["iwdee", "HOWPARTY", TDA],
    ["bg2ee", "OH6000", ARE],
    ["bgee", "OH1000", ARE],
    ["iwd2", "AR6050", ARE],
    ["pst", "AR0104A", ARE],
    ["tob", "AR6111", ARE],
    ["bg2", "AR0083", ARE],
    ["totlm", "AR9715", ARE],
    ["how", "AR9109", ARE],
    ["iwd", "AR2116", ARE],
    ["totsc", "AR2003", ARE],
    ["bg1", "AR0125", ARE],
];

const FLAVOUR_LABEL: Record<IeFlavour, string> = {
    bg1: "Baldur's Gate",
    totsc: "Baldur's Gate: Tales of the Sword Coast",
    bg2: "Baldur's Gate II: Shadows of Amn",
    tob: "Baldur's Gate II: Throne of Bhaal",
    bgt: "Baldur's Gate Trilogy",
    iwd: "Icewind Dale",
    how: "Icewind Dale: Heart of Winter",
    totlm: "Icewind Dale: Trials of the Luremaster",
    iwd2: "Icewind Dale II",
    pst: "Planescape: Torment",
    bgee: "Baldur's Gate: Enhanced Edition",
    sod: "Baldur's Gate: Siege of Dragonspear",
    bg2ee: "Baldur's Gate II: Enhanced Edition",
    iwdee: "Icewind Dale: Enhanced Edition",
    pstee: "Planescape: Torment: Enhanced Edition",
    eet: "Enhanced Edition Trilogy",
};

const FLAVOUR_SHORT: Record<IeFlavour, string> = {
    bg1: "BG1",
    totsc: "BG1: TotSC",
    bg2: "BG2: SoA",
    tob: "BG2: ToB",
    bgt: "BGT",
    iwd: "IWD",
    how: "IWD: HoW",
    totlm: "IWD: TotLM",
    iwd2: "IWD2",
    pst: "PST",
    bgee: "BGEE",
    sod: "BGEE: SoD",
    bg2ee: "BG2EE",
    iwdee: "IWDEE",
    pstee: "PSTEE",
    eet: "EET",
};

// Coarse fallback flavour when no fine area marker is present (an unusual or stripped install).
const COARSE_FLAVOUR: Record<IeScriptStyle, IeFlavour> = {
    bg1: "bg1",
    bg2: "bg2",
    iwd1: "iwd",
    iwd2: "iwd2",
    pst: "pst",
};

export function detectGameIdentity(key: KeyIndex): GameIdentity {
    let variant: IeVariant = "generic";
    let scriptStyle: IeScriptStyle = "bg1";
    for (const [resref, type, testVariant, testStyle] of COARSE_TESTS) {
        if (key.lookup(resref, type) !== undefined) {
            variant = testVariant;
            scriptStyle = testStyle;
        }
    }
    const edition = variant === "generic" ? "classic" : "ee";
    const detected = FLAVOUR_MARKERS.find(([, resref, type]) => key.lookup(resref, type) !== undefined)?.[0];
    const flavour = detected ?? (variant === "generic" ? COARSE_FLAVOUR[scriptStyle] : variant);
    return {
        variant,
        scriptStyle,
        edition,
        flavour,
        label: FLAVOUR_LABEL[flavour],
        shortLabel: FLAVOUR_SHORT[flavour],
    };
}

/**
 * Refine a KEY-detected identity for the conversions/expansions that layer on a base game and are visible only
 * against the LIVE install (override resources and loose files), not the KEY: EET (a BG2EE megamod, `eet.flag`
 * in override or `data/eetTU00.bif`), SoD (BGEE + Siege of Dragonspear, `movies/sodcin01.wbm`), and BGT (BG1
 * rebuilt on the BG2 engine, `AR7200.ARE` in override). Markers match the ones WeiDU's `GAME_IS` and Near
 * Infinity's game detection use. `resExists` = resource resolves (KEY or override); `fileExists` = a loose file
 * under the game dir.
 */
export function refineGameFlavour(
    base: GameIdentity,
    resExists: (resref: string, type: number) => boolean,
    fileExists: (relPath: string) => boolean,
): GameIdentity {
    let flavour: IeFlavour | undefined;
    if (fileExists("override/eet.flag") || fileExists("data/eetTU00.bif")) flavour = "eet";
    else if (base.flavour === "bgee" && fileExists("movies/sodcin01.wbm")) flavour = "sod";
    else if ((base.flavour === "bg2" || base.flavour === "tob") && resExists("AR7200", ARE)) flavour = "bgt";
    if (flavour === undefined || flavour === base.flavour) return base;
    return { ...base, flavour, label: FLAVOUR_LABEL[flavour], shortLabel: FLAVOUR_SHORT[flavour] };
}
