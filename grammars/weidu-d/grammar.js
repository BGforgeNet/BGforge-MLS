/**
 * Tree-sitter grammar for WeiDU D (dialog) files.
 * Supports: BEGIN, APPEND, EXTEND_TOP, EXTEND_BOTTOM, CHAIN, INTERJECT,
 * states, transitions, and various text replacement actions.
 *
 * @file WeiDU D grammar
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// =========================================
// HELPER FUNCTIONS
// =========================================

/** choice() that handles single keyword without warning */
const kw = (...keywords) => (keywords.length === 1 ? keywords[0] : choice(...keywords));

/** Replace text action: KEYWORD file old new [moreFiles] [when] */
const replaceTextAction =
    (...keywords) =>
    (fileType) =>
    ($) =>
        seq(
            kw(...keywords),
            field("file", fileType($)),
            field("old_text", $.string),
            field("new_text", $.string),
            repeat(fileType($)),
            repeat($.d_action_when),
        );

/** Replace trans action: KEYWORD file states trans old new [when] */
const replaceTransAction = (keyword) => ($) =>
    seq(
        keyword,
        field("file", $._filename),
        $._state_label_list,
        $._trans_number_list,
        field("old_text", $.string),
        field("new_text", $.string),
        repeat($.d_action_when),
    );

export default grammar({
    name: "weidu_d",

    // The literal and %var% pieces of an interpolated name, scanned in src/scanner.c. As
    // token.immediate they duplicated the identifier machine into a second lex mode across every
    // state a filename can reach; see the scanner's header for what that cost at runtime.
    externals: ($) => [$._immediate_identifier, $._immediate_variable_ref],

    extras: ($) => [/\s/, $.comment, $.line_comment],

    // Keyword extraction: without it every keyword is spelled out character by character in each
    // lex state that admits an identifier, rather than once in the generated keyword lexer.
    word: ($) => $.identifier,

    rules: {
        source_file: ($) => repeat($._d_action),

        _d_action: ($) =>
            choice(
                $.begin_action,
                $.append_action,
                $.extend_action,
                $.chain_action,
                $.interject_action,
                $.interject_copy_trans,
                $.replace_action,
                $.replace_action_text,
                $.replace_action_text_regexp,
                $.replace_action_text_process,
                $.alter_trans,
                $.replace_trans_trigger,
                $.replace_trans_action,
                $.replace_trigger_text,
                $.replace_trigger_text_regexp,
                $.replace_state_trigger,
                $.replace_say,
                $.set_weight,
                $.add_state_trigger,
                $.add_trans_trigger,
                $.add_trans_action,
            ),

        // BEGIN filename [nonPausing] state list
        begin_action: ($) =>
            seq("BEGIN", field("file", $._filename), optional(field("non_pausing", $.number)), repeat($.state)),

        // APPEND [IF_FILE_EXISTS] filename state list END
        append_action: ($) =>
            seq(
                choice("APPEND", "APPEND_EARLY"),
                optional("IF_FILE_EXISTS"),
                field("file", $._filename),
                repeat($.state),
                "END",
            ),

        // EXTEND_TOP/EXTEND_BOTTOM filename stateLabel list [#positionNumber] transition list END
        extend_action: ($) =>
            seq(
                choice("EXTEND_TOP", "EXTEND_BOTTOM"),
                field("file", $._filename),
                field("states", repeat1($._state_label)),
                optional(seq("#", $.number)),
                repeat($.transition),
                "END",
            ),

        // CHAIN [IF [WEIGHT #weight] trigger THEN] [IF_FILE_EXISTS] entryFile entryLabel chainText chainEpilogue
        chain_action: ($) =>
            seq(
                field("keyword", choice("CHAIN", "CHAIN3")),
                optional(
                    seq("IF", optional(seq("WEIGHT", $._weight_value)), field("trigger", $.string), optional("THEN")),
                ),
                optional("IF_FILE_EXISTS"),
                field("file", $._filename),
                field("label", $._state_label),
                repeat($.chain_text),
                $.chain_epilogue,
            ),

        // INTERJECT entryFile entryLabel globalVar chain_speaker* chainEpilogue
        interject_action: ($) =>
            seq(
                "INTERJECT",
                field("file", $._filename),
                field("label", $._state_label),
                field("global_var", $.identifier),
                repeat($.chain_speaker),
                $.chain_epilogue,
            ),

        // INTERJECT_COPY_TRANS[2-4] [SAFE] entryFile entryLabel globalVar chain_speaker* chainEpilogue
        interject_copy_trans: ($) =>
            seq(
                choice(
                    "INTERJECT_COPY_TRANS",
                    "INTERJECT_COPY_TRANS2",
                    "INTERJECT_COPY_TRANS3",
                    "INTERJECT_COPY_TRANS4",
                    // I_C_T[2-4] are WeiDU's documented shorthand aliases for the
                    // INTERJECT_COPY_TRANS[2-4] keywords above (same construct).
                    "I_C_T",
                    "I_C_T2",
                    "I_C_T3",
                    "I_C_T4",
                ),
                optional("SAFE"),
                field("file", $._filename),
                field("label", $._state_label),
                field("global_var", $.identifier),
                repeat($.chain_speaker),
                // Plain END, not a chain_epilogue: the construct already implies the copy, so WeiDU
                // gives it no epilogue choice where a bare INTERJECT takes the full set.
                "END",
            ),

        // chainText: [IF trigger THEN] sayText [== ... | BRANCH ...]
        chain_text: ($) =>
            seq(
                optional($._if_trigger_then),
                $.say_text,
                optional($.do_feature),
                repeat(choice($.chain_speaker, $.chain_branch)),
            ),

        // == [IF_FILE_EXISTS] fileName [IF trigger [THEN]] sayText [DO action]
        chain_speaker: ($) =>
            seq(
                "==",
                optional("IF_FILE_EXISTS"),
                field("file", $._filename),
                optional($._if_trigger_then),
                $.say_text,
                optional($.do_feature),
            ),

        // BRANCH trigger BEGIN [== fileName [IF trigger THEN] sayText ...] END
        chain_branch: ($) => seq("BRANCH", field("trigger", $.string), "BEGIN", repeat($.chain_speaker), "END"),

        // chainEpilogue: END file state | EXTERN file state | COPY_TRANS file state | EXIT | END transitions
        chain_epilogue: ($) =>
            choice(
                seq("END", field("file", $._filename), field("label", $._state_label)),
                seq("EXTERN", field("file", $._filename), field("label", $._state_label)),
                seq(
                    choice("COPY_TRANS", "COPY_TRANS_LATE"),
                    optional("SAFE"),
                    field("file", $._filename),
                    field("label", $._state_label),
                ),
                "EXIT",
                seq("END", repeat($.transition)),
            ),

        // REPLACE filename state list END
        replace_action: ($) => seq("REPLACE", field("file", $._filename), repeat($.state), "END"),

        // Text replacement actions (using helpers)
        replace_action_text: replaceTextAction("REPLACE_ACTION_TEXT")(($) => $._filename),

        replace_action_text_regexp: replaceTextAction("REPLACE_ACTION_TEXT_REGEXP")(($) => $.string),

        replace_action_text_process: replaceTextAction(
            "REPLACE_ACTION_TEXT_PROCESS",
            "REPLACE_ACTION_TEXT_PROCESS_REGEXP",
            "R_A_T_P_R",
        )(($) => $._filename),

        // ALTER_TRANS filename BEGIN stateNumber list END BEGIN transNumber list END BEGIN changes END
        alter_trans: ($) =>
            seq(
                "ALTER_TRANS",
                field("file", $._filename),
                $._state_label_list,
                $._trans_number_list,
                "BEGIN",
                repeat($.alter_trans_change),
                "END",
            ),

        // A change is `field value`, where field is a WeiDU trans field. It is usually a bareword
        // (ACTION, TRIGGER, EPILOGUE, ...) but a quoted "field" form is also accepted.
        alter_trans_change: ($) => seq(choice($.double_string, $.identifier), $.string),

        // Trans replacement actions (using helper)
        replace_trans_trigger: replaceTransAction("REPLACE_TRANS_TRIGGER"),
        replace_trans_action: replaceTransAction("REPLACE_TRANS_ACTION"),

        // REPLACE_TRIGGER_TEXT filename oldText newText [dActionWhen]
        replace_trigger_text: ($) =>
            seq(
                "REPLACE_TRIGGER_TEXT",
                field("file", $._filename),
                field("old_text", $.string),
                field("new_text", $.string),
                repeat($.d_action_when),
            ),

        // REPLACE_TRIGGER_TEXT_REGEXP filenameRegexp oldText newText [dActionWhen]
        replace_trigger_text_regexp: ($) =>
            seq(
                "REPLACE_TRIGGER_TEXT_REGEXP",
                field("file", $.string),
                field("old_text", $.string),
                field("new_text", $.string),
                repeat($.d_action_when),
            ),

        // REPLACE_STATE_TRIGGER filename stateNumber triggerString [moreStateNumbers] [dActionWhen]
        replace_state_trigger: ($) =>
            seq(
                "REPLACE_STATE_TRIGGER",
                field("file", $._filename),
                field("state", $._state_label),
                field("trigger", $.string),
                repeat($._state_label),
                repeat($.d_action_when),
            ),

        // REPLACE_SAY filename stateLabel sayText
        replace_say: ($) =>
            seq("REPLACE_SAY", field("file", $._filename), field("state", $._state_label), field("text", $._text)),

        // SET_WEIGHT filename stateLabel #stateWeight
        set_weight: ($) =>
            seq(
                "SET_WEIGHT",
                field("file", $._filename),
                field("state", $._state_label),
                field("weight", $._weight_value),
            ),

        // ADD_STATE_TRIGGER filename stateN [dActionWhen] triggerString [stateN ...]
        // WeiDU allows the trigger to apply to multiple additional states listed after
        // the trigger string.
        add_state_trigger: ($) =>
            seq(
                "ADD_STATE_TRIGGER",
                field("file", $._filename),
                field("state", $._state_label),
                optional($.d_action_when),
                field("trigger", $.string),
                repeat($._state_label),
            ),

        // ADD_TRANS_TRIGGER filename stateN triggerString [moreStates] [DO transNumbers] [dActionWhen]
        add_trans_trigger: ($) =>
            seq(
                "ADD_TRANS_TRIGGER",
                field("file", $._filename),
                field("state", $._state_label),
                field("trigger", $.string),
                repeat($._state_label),
                optional(seq("DO", repeat1($.number))),
                repeat($.d_action_when),
            ),

        // ADD_TRANS_ACTION filename BEGIN states END BEGIN trans END [dActionWhen] actionString
        add_trans_action: ($) =>
            seq(
                "ADD_TRANS_ACTION",
                field("file", $._filename),
                $._state_label_list,
                $._trans_number_list,
                optional($.d_action_when),
                field("action", $.string),
                // The IF/UNLESS guard may also trail the action string (WeiDU accepts both positions).
                optional($.d_action_when),
            ),

        // dActionWhen - conditional for D actions
        d_action_when: ($) =>
            choice(seq("IF", field("condition", $.string)), seq("UNLESS", field("condition", $.string))),

        // IF [WEIGHT #n] ~trigger~ [THEN] [BEGIN] label SAY text [= text...] transitions END
        state: ($) =>
            seq(
                "IF",
                optional(seq("WEIGHT", field("weight", $._weight_value))),
                field("trigger", $.string),
                optional("THEN"),
                optional("BEGIN"),
                field("label", $._state_label),
                "SAY",
                field("say", $.say_text),
                repeat($.transition),
                "END",
            ),

        // SAY text [= text ...]
        say_text: ($) => seq($._text, repeat(seq("=", $._text))),

        // Transitions. A bare %var% here stands in for structure this file never states - its value
        // comes from elsewhere in the install (a variable set in a .tp2 may reach a .d), and WeiDU
        // rejects such a file parsed on its own. A %var% in a name or text position substitutes a
        // value rather than structure and stays accepted.
        transition: ($) => choice($.transition_full, $.transition_short, $.copy_trans),

        // IF ~trigger~ [THEN] transFeatures transNext
        transition_full: ($) =>
            seq("IF", field("trigger", $.string), optional("THEN"), repeat($._trans_feature), $._trans_next),

        // + [~trigger~] + replyText transFeatures transNext
        transition_short: ($) =>
            seq(
                "+",
                optional(field("trigger", $.string)),
                "+",
                field("reply", $._text),
                repeat($._trans_feature),
                $._trans_next,
            ),

        // COPY_TRANS [SAFE] filename stateLabel
        copy_trans: ($) =>
            seq(
                choice("COPY_TRANS", "COPY_TRANS_LATE"),
                optional("SAFE"),
                field("file", $._filename),
                field("state", $._state_label),
            ),

        // Transaction features
        _trans_feature: ($) => choice($.reply_feature, $.do_feature, $.journal_feature, $.flags_feature),

        reply_feature: ($) => seq("REPLY", field("text", $._text)),

        do_feature: ($) => seq("DO", field("action", $.string)),

        journal_feature: ($) => seq(choice("JOURNAL", "SOLVED_JOURNAL", "UNSOLVED_JOURNAL"), field("text", $._text)),

        flags_feature: ($) => seq("FLAGS", $.number),

        // Transaction next (where to go)
        _trans_next: ($) => choice($.goto_next, $.extern_next, $.exit_next, $.short_goto),

        goto_next: ($) => seq("GOTO", field("label", $._state_label)),

        extern_next: ($) =>
            seq("EXTERN", optional("IF_FILE_EXISTS"), field("file", $._filename), field("label", $._state_label)),

        exit_next: ($) => "EXIT",

        // + stateLabel (shorthand for GOTO)
        short_goto: ($) => seq("+", field("label", $._state_label)),

        // Filename can be identifier, string, variable ref, or a %var%-interpolated name
        _filename: ($) => choice($.identifier, $.string, $.variable_ref, $.interpolated_name),

        // A name assembled by concatenating %var% references with abutting literal text, e.g.
        // %tutu_var%KELDDA (the value of tutu_var, then "KELDDA") or TAZOK%eet_var%. A DELIBERATE
        // divergence: WeiDU lexes each %...% run as its own string token, so it reads this as two
        // arguments where one name was meant and rejects the file; we accept it to stay quiet on
        // source that installs fine once the variable is resolved. The pieces must abut - the scanner
        // refuses across whitespace, so `%var% NAME` stays two tokens.
        interpolated_name: ($) =>
            seq(
                choice($.variable_ref, $.identifier),
                repeat1(
                    choice(
                        alias($._immediate_identifier, $.identifier),
                        alias($._immediate_variable_ref, $.variable_ref),
                    ),
                ),
            ),

        // State label can be number, identifier, alphanumeric (like 4a), variable ref, or string (like ~13~)
        // A label is lexically just an identifier, so it is the same token aliased: two overlapping
        // identifier-shaped tokens forced the lexer to keep both machines alive wherever either was
        // admissible, which cost more than the keywords did.
        _state_label: ($) => choice(alias($.identifier, $.state_label_alnum), $.variable_ref, $.string),

        // Weight value: #[-]number
        _weight_value: ($) => seq("#", optional("-"), $.number),

        // BEGIN...END state label list
        _state_label_list: ($) => seq("BEGIN", repeat($._state_label), "END"),

        // BEGIN...END transaction number list
        _trans_number_list: ($) => seq("BEGIN", repeat($.number), "END"),

        // IF trigger [THEN] pattern
        _if_trigger_then: ($) => seq("IF", field("trigger", $.string), optional("THEN")),

        // Text types. %var% belongs here because WeiDU lexes a %...% run as a plain string token, so a
        // variable stands wherever a string does - a say text among them (`CHAIN ... %kivan17%`, which
        // OUTER_SPRINT sets to a strref). It substitutes a value, not structure.
        _text: ($) => choice($.string, $.tra_ref, $.tlk_ref, $.at_var_ref, $.variable_ref),

        // String literals
        string: ($) => choice($.tilde_string, $.double_string),

        tilde_string: ($) => seq("~", optional($.tilde_content), "~"),
        tilde_content: ($) => /[^~]+/,

        double_string: ($) => seq('"', optional($.double_content), '"'),
        double_content: ($) => /[^"]+/,

        // References
        tra_ref: ($) => token(seq("@", /[0-9]+/)),
        tlk_ref: ($) => token(seq("#", /[0-9]+/)),
        at_var_ref: ($) => seq("(", "AT", $.double_string, ")"),

        // WeiDU variable reference %name% (allows # in names for namespacing)
        variable_ref: ($) => token(seq("%", /[A-Za-z_][A-Za-z0-9_#]*/, "%")),

        // Basic tokens. The one identifier-shaped token in the grammar: it also carries state labels
        // (aliased at _state_label), and its shape is WeiDU's own bare-word token, which WeiDU matches
        // before looking the text up as a keyword - the same two steps `word:` above sets up. # is
        // namespacing (RR#INT01); labels contribute the leading digit (4a, 100), the dots (KHPC1.1)
        // and the hyphens (Quayle_Shar-Teel_1). `number` is integer-only, so a dotted run is a label,
        // never a float. Splitting these back into two narrower tokens is what made the lexer big.
        identifier: ($) => /[A-Za-z0-9_][A-Za-z0-9_#.-]*/,
        number: ($) => /[0-9]+/,

        // Comments
        comment: ($) => seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/"),
        line_comment: ($) => seq("//", /[^\n]*/),
    },
});
