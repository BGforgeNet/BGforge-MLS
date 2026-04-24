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

        response: ($) =>
            seq(
                alias(/[Rr][Ee][Ss][Pp][Oo][Nn][Ss][Ee]/, "RESPONSE"),
                "#",
                field("weight", $.number),
                repeat1($.action), // At least one action required
            ),

        action: ($) => field("call", $.call_expr),

        // Function call: Name(args) or Name()
        call_expr: ($) => seq(field("func", $.identifier), "(", optional(commaSep(field("args", $._argument))), ")"),

        _argument: ($) =>
            choice(
                $.call_expr,
                $.point, // Must be before object_ref to avoid ambiguity with [0.0]
                $.object_ref,
                $.tra_ref,
                $.variable_ref,
                $.string,
                $.number,
                $.identifier,
            ),

        // TRA reference: @123 (no spaces allowed)
        tra_ref: ($) => token(seq("@", /\d+/)),

        // Special object identifiers: [PC], [ENEMY], [ANYONE], etc.
        object_ref: ($) => seq("[", /[A-Za-z0-9_.]+/, "]"),

        // Point notation: [x.y] for coordinates (can use variable refs)
        point: ($) => seq("[", $._point_coord, ".", $._point_coord, "]"),
        _point_coord: ($) => choice($.number, $.variable_ref),

        // Variable reference: %varname% (no spaces allowed)
        variable_ref: ($) => token(seq("%", /[a-zA-Z_][a-zA-Z0-9_]*/, "%")),

        // Terminals
        identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

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
