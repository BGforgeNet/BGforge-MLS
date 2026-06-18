/**
 * @file Fallout message file (.msg)
 * @author BGforge <dev@bgforge.net>
 * @license MIT
 *
 * Format: {number}{audio}{text} entries, where audio is optional (but braces required).
 * Text can span multiple lines. Outside entries, only marked comments are allowed
 * (# and // line comments, or block comments); markerless free text is a parse error.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

export default grammar({
    name: "fallout_msg",

    extras: ($) => [/\s/],

    rules: {
        source_file: ($) => repeat(choice($.entry, $.comment, $.block_comment)),

        // {number}{audio}{text}
        // Text can span multiple lines - closing } terminates.
        entry: ($) =>
            seq(
                "{",
                field("number", $.number),
                "}",
                "{",
                field("audio", optional($.audio)),
                "}",
                "{",
                field("text", optional($.text)),
                "}",
            ),

        number: () => /\d+/,

        // Audio filename (non-empty content between second pair of braces)
        audio: () => /[^}]+/,

        // Message text - may contain newlines, terminated by }
        text: () => /[^}]+/,

        // Comments must be explicitly marked. '#' and '//' are line comments;
        // markerless free text outside an entry is left unparsed (an ERROR node)
        // so it surfaces as a diagnostic rather than being silently accepted.
        comment: () => token(choice(seq("#", /[^\n]*/), seq("//", /[^\n]*/))),

        // '/* ... */' block comment (may span multiple lines).
        block_comment: () => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),
    },
});
