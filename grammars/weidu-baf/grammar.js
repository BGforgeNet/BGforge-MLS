/**
 * @file WeiDU BAF (Infinity Engine script)
 * @author BGforge <dev@bgforge.net>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

export default grammar({
    name: "baf",

    extras: ($) => [/\s/, $.comment, $.line_comment],

    // `[10.10]` is a valid prefix of both a point and an object_ref, and which one it is only becomes clear
    // at the closing bracket - too late for LR(1), which must reduce the first coordinate before it can see
    // the arity. Declaring the conflict lets the GLR parser carry both readings until the bracket closes,
    // and point's prec.dynamic picks the winner where both survive. See the point rule for why point wins.
    conflicts: ($) => [[$._object_component, $._point_coord]],

    rules: {
        source_file: ($) => repeat($.block),

        // IF ... THEN ... RESPONSE ... END
        block: ($) => seq(field("if", $.if_clause), field("then", $.then_clause), alias(/[Ee][Nn][Dd]/, "END")),

        if_clause: ($) => seq(alias(/[Ii][Ff]/, "IF"), repeat($._condition_item)),

        _condition_item: ($) => choice($.or_marker, $.condition),

        // OR(N) marker - the count is semantic, grammar just captures it
        or_marker: ($) => seq(alias(/[Oo][Rr]/, "OR"), "(", field("count", $.number), ")"),

        condition: ($) => seq(optional("!"), field("call", $.call_expr)),

        then_clause: ($) => seq(alias(/[Tt][Hh][Ee][Nn]/, "THEN"), repeat1($.response)),

        // A response may hold no actions at all. The reference compiler accepts one and writes it as a bare
        // weight, and compiled scripts really do carry them - 28 files in a stock BG:EE plus BG2:ToB pair.
        response: ($) =>
            seq(
                alias(/[Rr][Ee][Ss][Pp][Oo][Nn][Ss][Ee]/, "RESPONSE"),
                "#",
                field("weight", $.number),
                repeat($.action),
            ),

        action: ($) => field("call", $.call_expr),

        // Function call: Name(args) or Name()
        call_expr: ($) => seq(field("func", $.identifier), "(", optional(commaSep(field("args", $._argument))), ")"),

        _argument: ($) =>
            choice($.call_expr, $.point, $.object_ref, $.tra_ref, $.variable_ref, $.string, $.number, $.identifier),

        // TRA reference: @123 (no spaces allowed)
        tra_ref: ($) => token(seq("@", /\d+/)),

        // Object identifiers: a name ([PC], [ENEMY]) or a dot-separated specifier
        // ([NOTGOOD.HUMANOID], [EA.GENERAL.RACE.CLASS.SPECIFIC.GENDER.ALIGNMENT]), whose components are
        // IDS names or their numeric equivalents ([0.0.0.MAGE_ALL]).
        //
        // The components are matched individually rather than by one `/[A-Za-z0-9_.]+/` token. That token
        // spanned the dots, so the lexer consumed `10.10` whole and won `[10.10]` against `point` on longest
        // match - `point` could only ever win when a coordinate held a character the token could not match,
        // i.e. `-` or `%`. Coordinates therefore parsed as points when negative and as object refs when
        // positive, and a mixed `[200.%y%]` parsed as neither.
        object_ref: ($) => seq("[", $._object_component, repeat(seq(".", $._object_component)), "]"),
        _object_component: ($) => choice($.identifier, $.number),

        // Point notation: [x.y] coordinates, e.g. MoveToPoint([10.10]) or CreateCreature("x",[%px%.%py%],0).
        //
        // `[10.10]` is genuinely ambiguous in BAF - the engine reads it as a point or as a two-component
        // EA.GENERAL specifier depending on the called function's signature, which a context-free grammar
        // cannot see. It is resolved structurally instead, on the evidence of the shipped scripts: across 730
        // mod .baf files every two-component all-numeric bracket (1495 of them) is an argument to a
        // point-taking function (CreateCreature, JumpToPoint, MoveViewPoint, FadeToColor, ...) and none is an
        // object specifier, while every two-component specifier that IS an object ref names its components
        // ([NOTGOOD.HUMANOID], [EVILCUTOFF.UNDEAD]). So numeric components mean a point; named components mean
        // an object ref. The prec.dynamic resolves the remaining overlap - both rules match `[ number .
        // number ]`, so the GLR parser keeps both and this picks the point, the reading that occurs in
        // practice. A specifier of any other arity is unaffected: point is exactly two components, so only
        // object_ref survives and the dynamic precedence never applies.
        point: ($) => prec.dynamic(1, seq("[", $._point_coord, ".", $._point_coord, "]")),
        _point_coord: ($) => choice($.number, $.variable_ref),

        // Variable reference: %varname% (no spaces allowed)
        variable_ref: ($) => token(seq("%", /[a-zA-Z_][a-zA-Z0-9_]*/, "%")),

        // Terminals

        // The hyphen is part of the name: IDS symbols carry it (RACE.IDS has KUO-TOA, YUAN-TI, WILL-O-WISP).
        // BAF has no arithmetic, so a hyphen's only other role is leading a negative `number` - which the
        // leading [a-zA-Z_] keeps out of an identifier.
        identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_-]*/,

        number: ($) => token(choice(/-?\d+/, /0x[0-9a-fA-F]+/)),

        string: ($) => choice(seq('"', /[^"\n]*/, '"'), seq("~", /[^~\n]*/, "~")),

        comment: ($) => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),

        line_comment: ($) => token(seq("//", /[^\n]*/)),
    },
});

/**
 * Comma-separated list
 */
function commaSep(rule) {
    return seq(rule, repeat(seq(",", rule)));
}
