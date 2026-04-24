/**
 * @file WeiDU translation file (.tra)
 * @author BGforge <dev@bgforge.net>
 * @license MIT
 *
 * Format: @number = string [string] [sound_ref]
 * Strings can be delimited by ~text~, "text", or ~~~~~text~~~~~.
 * Comments (// and block) only appear between entries.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

export default grammar({
    name: "weidu_tra",

    extras: ($) => [/\s/, $.comment, $.block_comment],

    externals: ($) => [$.tilde_string],

    conflicts: ($) => [],

    rules: {
        source_file: ($) => repeat($.entry),

        // @number = string [female_string] [sound_ref]
        entry: ($) =>
            seq(
                "@",
                field("number", $.number),
                "=",
                field("text", $._string),
                optional(field("female_text", $._string)),
                optional(field("sound", $.sound_ref)),
            ),

        number: () => /-?\d+/,

        // Use _string (hidden) to wrap the actual string rules. This ensures
        // tree-sitter processes extras before attempting the external scanner.
        _string: ($) => choice($.tilde_string, $.double_string),

        // tilde_string is handled entirely by the external scanner:
        // matches both ~text~ and ~~~~~text~~~~~

        // "text" — double-quote delimited, can span multiple lines
        double_string: () => token(seq('"', /[^"]*/, '"')),

        // [SOUNDREF]
        sound_ref: () => seq("[", /\w+/, "]"),

        comment: () => token(seq("//", /[^\n]*/)),

        block_comment: () => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),
    },
});
