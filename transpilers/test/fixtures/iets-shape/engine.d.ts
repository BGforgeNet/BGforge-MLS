/**
 * The declaration half of an iets-shaped dependency: engine builtins with no runtime body.
 *
 * Nothing here can be emitted, so the bundler must externalise this file rather than parse it into the
 * output. Kept separate from lib.ts because that split - declarations beside real values in one
 * dependency - is what decides whether the package as a whole can be externalised.
 */

export declare const Player1: number;
export declare function See(who: number): boolean;
export declare function Attack(who: number): void;
export declare function Polymorph(what: number): void;

/**
 * An IDS table as `declare enum`, the shape iets uses (animate.ids.d.ts and forty siblings).
 *
 * The bundler drops `declare enum` entirely, so the emitted script would carry `Animate.MAGE_MALE_HUMAN`
 * - a name the engine cannot resolve - unless the enum's name was collected while externalising this file
 * and the prefix stripped afterwards. That collection is the half a declarations-only shortcut loses, and
 * it fails silently: output is produced, and only the constant is wrong.
 */
export declare enum Animate {
    MAGE_MALE_HUMAN = 0x0300,
}
