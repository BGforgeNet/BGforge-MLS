/**
 * The Baldur's Gate family's effect animations - the ids below 0x1000 that no install declares.
 *
 * These are not creature avatars. Every id here is named by `ANIMATE.IDS` and `ANISND.IDS`, and no install
 * of the family - classic OR Enhanced Edition - ships an INI for it, so the panel could list them and draw
 * none. A handful of neighbouring ids ARE declared, and those are not here: an install's own INI answers
 * for them. The mapping lives in the engine, which is the same reason the per-game tables beside this file
 * exist; the difference is that these rows are needed on an EE install too.
 *
 * The `ANISND.IDS` code cannot stand in for the file name. It is four characters where several of these are
 * eight, and it is SHARED: one code covers the five exploding-body-part ids, another covers the three cloud
 * ids plus the ice storm, which resolve to two different files. Reading it as a prefix would draw one
 * animation's art under another's name across most of this set.
 *
 * Every row was checked against a shipped classic Throne of Bhaal and a shipped Enhanced Edition archive:
 * each names a file both installs hold. A game that declares one of these itself keeps its own answer -
 * `bg2.ts` orders its derived rows after these, and `buildAnimationIndex` never consults a table for an id
 * the install has an INI for.
 *
 * `section: "effect"` throughout: each is a single unsuffixed BAM, which is what that section means.
 */

import { type TableRows } from "./table";

export const EFFECT_ROWS: TableRows = [
    [0x0000, { prefixes: ["SPRING"], section: "effect" }],
    [0x0001, { prefixes: ["SPFLAMES"], section: "effect" }],
    [0x0002, { prefixes: ["SPRDRASI"], section: "effect" }],
    [0x0003, { prefixes: ["SPFLAMES"], section: "effect" }],
    [0x0004, { prefixes: ["SPRDRASI"], section: "effect" }],
    [0x0100, { prefixes: ["SPCHUNKS"], section: "effect" }],
    // One file for all five body parts: the ids differ, the art does not.
    [0x0200, { prefixes: ["SPBLOOD"], section: "effect" }],
    [0x0210, { prefixes: ["SPBLOOD"], section: "effect" }],
    [0x0220, { prefixes: ["SPBLOOD"], section: "effect" }],
    [0x0230, { prefixes: ["SPBLOOD"], section: "effect" }],
    [0x0240, { prefixes: ["SPBLOOD"], section: "effect" }],
    [0x0300, { prefixes: ["SPSMPUFF"], section: "effect" }],
    // Kept though one reference implementation's classic table has no row for this id at all: every install
    // checked names it in `ANIMATE.IDS` and ships `SPSMPUFF`, so the absence is that table's, not the game's.
    [0x0301, { prefixes: ["SPSMPUFF"], section: "effect" }],
    [0x0400, { prefixes: ["SKLH"], section: "effect" }],
    // Both this and the `SPGLYPHI` the Baldur's Gate II rows carry exist in every install checked; that
    // row comes from a game's own declaration, so it wins where it applies and this covers the rest.
    // Both reference implementations name this one for every game, including Baldur's Gate II - and a
    // classic install's own `ANISND.IDS` code is `GLPH`, so which name it drew is genuinely unsettled.
    [0x0410, { prefixes: ["GLPHWRDH"], section: "effect" }],
    [0x0500, { prefixes: ["STNKCLDD"], section: "effect" }],
    [0x0510, { prefixes: ["STNKCLDD"], section: "effect" }],
    [0x0520, { prefixes: ["SPHORPUF"], section: "effect" }],
    [0x0600, { prefixes: ["STNKCLDD"], section: "effect" }],
    // The one member of the cloud group that draws its own art rather than the shared cloud.
    [0x0610, { prefixes: ["SPICESTM"], section: "effect" }],
    [0x0700, { prefixes: ["GREASEH"], section: "effect" }],
    [0x0710, { prefixes: ["GREASED"], section: "effect" }],
    [0x0800, { prefixes: ["WEBENTH"], section: "effect" }],
    [0x0810, { prefixes: ["WEBENTD"], section: "effect" }],
];
