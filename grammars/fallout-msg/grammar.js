/**
 * @file Fallout message file (.msg)
 * @author BGforge <dev@bgforge.net>
 * @license MIT
 *
 * Format: {number}{audio}{text} entries, where audio is optional (but braces required).
 * Text can span multiple lines. Anything outside entries is a comment.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

export default grammar({
    name: "fallout_msg",

    extras: ($) => [/\s/],

    rules: {
        source_file: ($) => repeat(choice($.entry, $.comment)),

        // {number}{audio}{text}
        // Text can span multiple lines — closing } terminates.
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

        // Message text — may contain newlines, terminated by }
        text: () => /[^}]+/,

        // Anything outside {n}{a}{t} entries is a comment.
        // Matches one or more characters that don't start an entry.
        comment: () => /[^{\s][^{]*/,
    },
});
