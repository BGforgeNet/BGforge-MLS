/**
 * @file Fallout message file (.msg)
 * @author BGforge <dev@bgforge.net>
 * @license MIT
 *
 * Format: {number}{audio}{text} entries, where audio is optional (but braces required).
 * The game loads a file by scanning for `{`: it has no comment syntax, so everything outside the braces of a
 * field is skipped - the grammar calls it a `loose_comment`, which is what authors write there, though a `#`
 * line holding a brace group is a live entry - and a `}` outside a field fails the whole file. Each field is
 * every byte up to the next `}`: no whitespace is skipped inside the braces, newlines do not count, and the
 * number must be `[+-]?digits`.
 * The external scanner reads the fields and the text between them, and enforces the field size limit.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

export default grammar({
    name: "fallout_msg",

    // Whitespace and loose comments are skipped between fields. Inside a field the scanner reads the field
    // first, so the field's own spaces are content.
    extras: ($) => [/\s/, $.loose_comment],

    externals: ($) => [$.number, $.audio, $.text, $.loose_comment],

    rules: {
        source_file: ($) => repeat($.entry),

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
    },
});
