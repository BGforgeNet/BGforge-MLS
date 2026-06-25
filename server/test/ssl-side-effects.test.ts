import { describe, expect, it } from "vitest";
import { sslSideEffectFunctions } from "../src/fallout-ssl/side-effects";
import { buildSignatureBlock } from "../../shared/tooltip-format";
import { LANG_FALLOUT_SSL_TOOLTIP } from "../../shared/languages";

// The side-effect function set is derived from the SSL builtin data: a function whose
// signature returns `void` is called for its effect, not its value, so it mutates game
// state - except a small display/debug surface that only shows text and would otherwise
// fire the badge on nearly every dialog node. The return-type signature lives as the first
// line of the generated tooltip fence in the symbol's hover markdown; build the fixtures
// with the REAL emitter (buildSignatureBlock) so this stays coupled to the generator format.
const sym = (name: string, signature: string) => ({
    name,
    markdown: buildSignatureBlock(signature, LANG_FALLOUT_SSL_TOOLTIP) + "\nDoc text for " + name + ".",
});

describe("sslSideEffectFunctions", () => {
    it("includes void builtins as side-effecting (the real mutating signal)", () => {
        const set = sslSideEffectFunctions([
            sym("set_global_var", "void set_global_var(uint var_index, int value)"),
            sym("give_pc_perk", "void give_pc_perk(int perk)"),
        ]);
        expect([...set].sort()).toEqual(["give_pc_perk", "set_global_var"]);
    });

    it("excludes non-void builtins - reads and queries are not side-effects", () => {
        const set = sslSideEffectFunctions([
            sym("metarule", "int metarule(int rule, int param)"),
            sym("global_var", "int global_var(uint var_index)"),
            sym("anim_busy", "bool anim_busy(ObjectPtr who)"),
        ]);
        expect(set.size).toBe(0);
    });

    it("excludes the display/debug void fns - they only show text, not mutate state", () => {
        const set = sslSideEffectFunctions([
            sym("display_msg", "void display_msg(string message)"),
            sym("debug_msg", "void debug_msg(string text)"),
            sym("float_msg", "void float_msg(ObjectPtr who, string message, int type)"),
            sym("display", "void display(string filename)"),
            sym("display_stats", "void display_stats"),
        ]);
        expect(set.size).toBe(0);
    });

    it("keeps a real state-mutator that shares the display surface's neighborhood", () => {
        // signal_end_game is void but ends the game - a real effect, not display. Guards
        // against the allowlist being widened to a name-prefix match.
        const set = sslSideEffectFunctions([sym("signal_end_game", "void signal_end_game")]);
        expect(set.has("signal_end_game")).toBe(true);
    });

    it("detects a void builtin written without parentheses", () => {
        const set = sslSideEffectFunctions([sym("animate_stand", "void animate_stand")]);
        expect(set.has("animate_stand")).toBe(true);
    });

    it("skips a symbol whose markdown carries no signature fence", () => {
        const set = sslSideEffectFunctions([{ name: "mystery", markdown: "Just prose, no fence." }]);
        expect(set.size).toBe(0);
    });
});
