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

    // The block comment nests, which a regex token cannot count: it is scanned in src/scanner.c.
    externals: ($) => [$.comment],

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
        or_marker: ($) => seq(alias(/[Oo][Rr]/, "OR"), "(", field("count", choice($._integer, $.variable_ref)), ")"),

        condition: ($) => seq(optional("!"), field("call", $.call_expr)),

        // The reference accepts a block with no response at all.
        then_clause: ($) => seq(alias(/[Tt][Hh][Ee][Nn]/, "THEN"), repeat($.response)),

        // A response may hold no actions at all. The reference compiler accepts one and writes it as a bare
        // weight, and compiled scripts really do carry them - 28 files in a stock BG:EE plus BG2:ToB pair.
        response: ($) =>
            seq(
                alias(/[Rr][Ee][Ss][Pp][Oo][Nn][Ss][Ee]/, "RESPONSE"),
                "#",
                field("weight", $.number),
                repeat($.action),
            ),

        action: ($) => field("call", choice($.call_expr, alias($._action_override, $.call_expr))),

        // Function call: Name(args) or Name(). A name may be a %variable%: a value the installing tp2 supplies.
        // A variable standing for a whole condition or action is NOT accepted: that is structure, not a value.
        call_expr: ($) =>
            seq(
                field("func", choice($.identifier, $.variable_ref)),
                "(",
                optional(commaSep(field("args", $._argument))),
                ")",
            ),

        // The reference reads ActionOverride as a word of its own and, for it alone, does not require the closing
        // parenthesis. It still takes exactly an object and a plain call, which is why the word cannot go through
        // call_expr: that rule needs the parenthesis. It is the same node, so every reader of a call sees it.
        _action_override: ($) =>
            seq(
                field("func", alias($._action_override_name, $.identifier)),
                "(",
                field("args", $._argument),
                ",",
                field("args", $.call_expr),
                optional(")"),
            ),
        _action_override_name: ($) => token(prec(1, /[Aa][Cc][Tt][Ii][Oo][Nn][Oo][Vv][Ee][Rr][Rr][Ii][Dd][Ee]/)),

        _argument: ($) => choice($._plain_argument, $.rect_arg, $.tlk_string, $._tilde_text),

        _plain_argument: ($) =>
            choice(
                $.call_expr,
                $.point,
                $.object_ref,
                $.tra_ref,
                $.variable_ref,
                $.string,
                $._integer,
                $.identifier,
                $.quoted_symbol,
            ),

        // An object may carry a rectangle after it: See(Player1[1.2.3.4]), See([ENEMY][1.2.3.4]). It changes the
        // object a call stores, so it is a node of its own rather than an argument the reader could skip.
        // Only the forms the reference gives a rectangle: not a ~text~, whose bracket is a sound.
        rect_arg: ($) =>
            seq(
                field(
                    "object",
                    choice($.call_expr, $.point, $.object_ref, $.string, $._integer, $.identifier, $.quoted_symbol),
                ),
                field("rect", $.rect),
            ),
        rect: ($) => seq("[", $._integer, ".", $._integer, ".", $._integer, ".", $._integer, "]"),

        // A text the dialog.tlk resolves, with the sound after it and a second text and sound for a female
        // speaker: ~he~ [M] ~she~ [F]. A text alone is a plain `string` node.
        tlk_string: ($) =>
            choice(
                seq($._tilde_text, $.sound, optional(seq($._tilde_text, optional($.sound)))),
                seq($._tilde_text, $._tilde_text, optional($.sound)),
            ),
        sound: ($) => seq("[", $.identifier, "]"),

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
        //
        // A component may be a %variable% (`[EA.%race%]`), and the bracket may be empty (`[]`).
        object_ref: ($) => seq("[", optional(seq($._object_component, repeat(seq(".", $._object_component)))), "]"),
        _object_component: ($) => choice($.identifier, $._integer, $.variable_ref, $.quoted_symbol),

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
        _point_coord: ($) => choice($._integer, $.variable_ref),

        // Variable reference: %varname% (no spaces allowed). It outranks the %...% string below where both read
        // the same text, so only a percent text that is not a bare name is a string.
        variable_ref: ($) => token(prec(1, seq("%", /[a-zA-Z_][a-zA-Z0-9_]*/, "%"))),

        // Terminals

        // The hyphen is part of the name: IDS symbols carry it (RACE.IDS has KUO-TOA, YUAN-TI, WILL-O-WISP).
        // BAF has no arithmetic, so a hyphen's only other role is leading a negative `number` - which the
        // leading letter keeps out of an identifier. A `#` or `!` may sit inside a name (`A6#0`), and a name
        // may start with `#` when a letter, `_`, `!` or `-` follows: that keeps `#100` a number.
        identifier: ($) => /([a-zA-Z_]|#[a-zA-Z_!-])[a-zA-Z0-9_#!-]*/,

        // A number is a decimal or hex literal, signed. `#5` (a hash, spaces allowed after it) is a number too,
        // read wherever a value goes; it is NOT the `#` of `RESPONSE #100`, which that rule spells out.
        // The reference's hex literal is a lower-case `0x` and decimal digits only, read as base 16: `0x19` is 25,
        // while `0xFF`, `0X10` and `0x1a` are syntax errors there (a quoted text is another matter).
        _integer: ($) => choice($.number, alias($._hash_number, $.number)),
        number: ($) => token(choice(/-?\d+/, /-?0x\d+/)),
        _hash_number: ($) => token(/#[ \t]*\d+/),

        // The `"` and `~` forms span lines, as the reference's do. One that never closes therefore reads on to
        // the next delimiter: the reference does the same. A percent text stops at whitespace instead, because a
        // lone `%` being typed would otherwise run on to the next one lines away (the TP2 grammar does the same),
        // which leaves `%two words%` unread - a bare name between percents is a variable_ref anyway.
        //
        // `string` is a plain double-quoted text or the five-tilde form, whose content may hold single tildes
        // (five of them end it). `_tilde_text` is the `~text~` and `%text%` form, the one that can be followed
        // by a sound or a second text, and is a `string` node too. A comment marker inside any of them is text:
        // each is a single token, so no extra can interrupt it.
        string: ($) =>
            token(
                choice(
                    seq('"', /[^"]*/, '"'),
                    seq("~~~~~", repeat(choice(/[^~]/, /~[^~]/, /~~[^~]/, /~~~[^~]/, /~~~~[^~]/)), "~~~~~"),
                ),
            ),
        _tilde_text: ($) => alias($._tilde_string, $.string),
        _tilde_string: ($) => token(choice(seq("~", /[^~]*/, "~"), seq("%", /[^%\s]*/, "%"))),

        // A name written between five double quotes, which may hold any character (spaces included).
        quoted_symbol: ($) =>
            token(seq('"""""', repeat(choice(/[^"]/, /"[^"]/, /""[^"]/, /"""[^"]/, /""""[^"]/)), '"""""')),

        line_comment: ($) => token(seq("//", /[^\n]*/)),
    },
});

/**
 * Comma-separated list
 */
function commaSep(rule) {
    return seq(rule, repeat(seq(",", rule)));
}
