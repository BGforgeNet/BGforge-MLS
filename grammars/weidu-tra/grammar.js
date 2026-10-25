/**
 * @file WeiDU translation file (.tra)
 * @author BGforge <dev@bgforge.net>
 * @license MIT
 *
 * Format: @number = male_string [sound] [female_string [sound]]
 * A string is ~text~, "text", %text%, ~~~~~text~~~~~ or a bare word, and strings join with ^. An entry's value
 * may also name another string: #N (a TLK entry), @N (another entry of the file) or (AT string).
 * Comments are // to the end of the line and block comments, which nest. Both may stand between any two tokens.
 * Strings and block comments may span lines; the external scanner reads their text (see src/scanner.c).
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

export default grammar({
    name: "weidu_tra",

    extras: ($) => [/\s/, $.comment, $.block_comment],

    // The scanner is asked for a comment wherever one may appear, which includes right after a string's
    // opening delimiter, so it reads a string's text first (see src/scanner.c).
    externals: ($) => [
        $._tilde_content,
        $._double_content,
        $._percent_content,
        $._five_tilde_content,
        $._block_comment_closed,
        $._block_comment_open,
        $.trans_ref,
    ],

    rules: {
        source_file: ($) => repeat($.entry),

        // @number = male_string [sound] [female_string [sound]]
        // WeiDU allows a sound after EACH string, so a male sound may precede the female string.
        entry: ($) =>
            seq(
                "@",
                field("number", $.number),
                "=",
                choice(
                    seq(
                        field("text", $._text),
                        optional(field("sound", $.sound_ref)),
                        optional(seq(field("female_text", $._text), optional(field("female_sound", $.sound_ref)))),
                    ),
                    field("text", $.string_ref),
                    field("text", $.trans_ref),
                    field("text", $.at_ref),
                ),
            ),

        number: () => /-?\d+/,

        // #N: the TLK entry N.
        string_ref: () => /#-?\d+/,

        // @N as a value: the text of entry N of the same file. An external token because the same `@N` at the
        // start of the next entry, followed by `=`, is not a value - an entry typed without a value yet must
        // not swallow the entry below it.
        // trans_ref: external

        // (AT string): the text under a symbolic name.
        at_ref: ($) => seq("(", "AT", $._string, ")"),

        _text: ($) => choice($._string, $.concat_string),

        concat_string: ($) => seq($._string, repeat1(seq("^", $._string))),

        // Use _string (hidden) to wrap the actual string rules.
        _string: ($) => choice($.tilde_string, $.double_string, $.percent_string, $.word_string),

        // ~text~ or ~~~~~text~~~~~ (a five-tilde string may hold single tildes). Text up to the closer is
        // read by the scanner, so a comment opener inside a string is text.
        tilde_string: ($) =>
            choice(seq("~", optional($._tilde_content), "~"), seq("~~~~~", optional($._five_tilde_content), "~~~~~")),

        // "text" - can span multiple lines, and has no escapes.
        double_string: ($) => seq('"', optional($._double_content), '"'),

        // %text% - a third delimiter alongside the tilde and double-quote forms, ending at the next '%'; real
        // corpus files (e.g. BGT tchinese setup.tra) use it. Can span multiple lines.
        percent_string: ($) => seq("%", optional($._percent_content), "%"),

        // A word with no delimiter is a string too: a name, a number, a file name.
        word_string: () => /[0-9A-Za-z_][0-9A-Za-z#_.\-]*/,

        // [SOUNDREF] - the bracketed sound resref. WeiDU accepts any character except the closing
        // bracket; real corpus resrefs use variable interpolation (%tutu_var%SIRIN05), '#' (X#BLANK),
        // embedded spaces (XAN 23) and lowercase (AMB_E04a), none of which \w admits. Newline is excluded so
        // an unclosed '[' fails locally instead of consuming the rest of the file.
        sound_ref: () => seq("[", /[^\]\n]+/, "]"),

        comment: () => token(seq("//", /[^\n]*/)),

        // A comment closed by its matching `*/` is one token; one never closed ends where the scanner decides
        // (see src/scanner.c) and the missing `*/` is reported.
        block_comment: ($) => seq("/*", choice($._block_comment_closed, seq($._block_comment_open, "*/"))),
    },
});
