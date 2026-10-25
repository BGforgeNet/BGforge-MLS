/**
 * Tree-sitter grammar for WeiDU D (dialog) files.
 * Supports: BEGIN, APPEND, EXTEND_TOP, EXTEND_BOTTOM, CHAIN, INTERJECT,
 * states, transitions, and various text replacement actions.
 *
 * @file WeiDU D grammar
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

/**
 * The words WeiDU reserves in D code: its D lexer returns each one as a keyword, never as a bare name, so none can be
 * a dialog name, a state label or a global variable. Taken from WeiDU 251, the version scripts/ensure-weidu.sh pins;
 * on a WeiDU upgrade, re-derive the list from that release's D lexer keyword table. That table also holds
 * EXTEND_TOP_REGEXP and EXTEND_BOTTOM_REGEXP, which no WeiDU rule uses; tree-sitter reserves only words the grammar
 * uses as tokens, so those two stay out and read as names here.
 * server/test/integration/weidu-d-grammar-differential.test.ts checks every entry, and those two, against the binary.
 */
const RESERVED_WORDS = [
    "ADD_STATE_TRIGGER",
    "ADD_TRANS_ACTION",
    "ADD_TRANS_TRIGGER",
    "ALTER_TRANS",
    "APPEND",
    "APPENDI",
    "APPEND_EARLY",
    "AT",
    "A_S_T",
    "A_T_T",
    "BEGIN",
    "BRANCH",
    "CHAIN",
    "CHAIN2",
    "CHAIN3",
    "COPY_TRANS",
    "COPY_TRANS_LATE",
    "DO",
    "END",
    "EXIT",
    "EXTEND",
    "EXTEND_BOTTOM",
    "EXTEND_TOP",
    "EXTERN",
    "FLAGS",
    "GOTO",
    "IF",
    "IF_FILE_EXISTS",
    "INTERJECT",
    "INTERJECT_COPY_TRANS",
    "INTERJECT_COPY_TRANS2",
    "INTERJECT_COPY_TRANS3",
    "INTERJECT_COPY_TRANS4",
    "I_C_T",
    "I_C_T2",
    "I_C_T3",
    "I_C_T4",
    "JOURNAL",
    "REPLACE",
    "REPLACE_ACTION_TEXT",
    "REPLACE_ACTION_TEXT_PROCESS",
    "REPLACE_ACTION_TEXT_PROCESS_REGEXP",
    "REPLACE_ACTION_TEXT_REGEXP",
    "REPLACE_SAY",
    "REPLACE_STATE_TRIGGER",
    "REPLACE_TRANS_ACTION",
    "REPLACE_TRANS_TRIGGER",
    "REPLACE_TRIGGER_TEXT",
    "REPLACE_TRIGGER_TEXT_REGEXP",
    "REPLY",
    "R_A_T",
    "R_A_T_P_R",
    "R_S_T",
    "R_T_T",
    "SAFE",
    "SAY",
    "SET_WEIGHT",
    "SOLVED_JOURNAL",
    "THEN",
    "UNLESS",
    "UNSOLVED_JOURNAL",
    "WEIGHT",
];

/** An integer as WeiDU converts one: decimal, hex, octal or binary, with `_` separators after the first digit. */
const INTEGER = /[0-9][0-9_]*|0[xX][0-9a-fA-F][0-9a-fA-F_]*|0[oO][0-7][0-7_]*|0[bB][01][01_]*/;
/** The same, signed, which only a quoted number can be: a bare word cannot start with a sign. */
const SIGNED_INTEGER = new RegExp(`[-+]?(${INTEGER.source})`);

// =========================================
// HELPER FUNCTIONS
// =========================================

/** choice() that handles single keyword without warning */
const kw = (...keywords) => (keywords.length === 1 ? keywords[0] : choice(...keywords));

/** Replace text action: KEYWORD file old new [moreFiles] [when] */
const replaceTextAction =
    (...keywords) =>
    ($) =>
        seq(
            kw(...keywords),
            field("file", $._filename),
            field("old_text", $._string_value),
            field("new_text", $._string_value),
            repeat($._filename),
            repeat($.d_action_when),
        );

/** Replace trans action: KEYWORD file states trans old new [when] */
const replaceTransAction = (keyword) => ($) =>
    seq(
        keyword,
        field("file", $._filename),
        $._state_label_list,
        $._trans_number_list,
        field("old_text", $._string_value),
        field("new_text", $._string_value),
        repeat($.d_action_when),
    );

/** State trigger action: KEYWORD file state trigger [moreStates] ... [when] - the extra states share the field. */
const stateTriggerAction =
    (keywords, ...tail) =>
    ($) =>
        seq(
            keywords,
            field("file", $._filename),
            field("state", $._state_label),
            field("trigger", $._string_value),
            repeat(field("state", $._state_label)),
            ...tail.map((t) => t($)),
            repeat($.d_action_when),
        );

export default grammar({
    name: "weidu_d",

    // The literal and %var% pieces of an interpolated name, scanned in src/scanner.c. As
    // token.immediate they duplicated the identifier machine into a second lex mode across every
    // state a filename can reach; see the scanner's header for what that cost at runtime.
    // Block comments nest, which no internal token can express. String contents are scanned there too: the
    // scanner is asked for a comment wherever one may appear, which includes right after a string's opening
    // delimiter, so only it can tell that `~/* b */~` is text.
    externals: ($) => [
        $._immediate_identifier,
        $._immediate_variable_ref,
        $.comment,
        $.tilde_content,
        $.double_content,
        $.five_tilde_content,
    ],

    extras: ($) => [/\s/, $.comment, $.line_comment],

    // Keyword extraction: without it every keyword is spelled out character by character in each
    // lex state that admits an identifier, rather than once in the generated keyword lexer.
    word: ($) => $.identifier,

    // WeiDU's lexer turns every keyword into its token wherever it appears, so a keyword never reads as a bare
    // name. Without this, tree-sitter would read one as an identifier wherever the keyword itself is not expected:
    // `GOTO EXIT` as a jump to a state named EXIT, or a state's closing END as the label of a GOTO being typed.
    reserved: {
        global: () => RESERVED_WORDS,
    },

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

        // BEGIN filename [nonPausing] state list.
        begin_action: ($) =>
            seq("BEGIN", field("file", $._filename), optional(field("non_pausing", $._integer)), repeat($._state_item)),

        // APPEND [IF_FILE_EXISTS] filename state list END
        append_action: ($) =>
            seq(
                choice("APPEND", "APPEND_EARLY"),
                optional("IF_FILE_EXISTS"),
                field("file", $._filename),
                repeat($._state_item),
                "END",
            ),

        // EXTEND_TOP/EXTEND_BOTTOM filename stateLabel list [#positionNumber] transition list END.
        // EXTEND is WeiDU's alias for EXTEND_BOTTOM. WeiDU takes an empty state list too.
        extend_action: ($) =>
            seq(
                choice("EXTEND_TOP", "EXTEND_BOTTOM", "EXTEND"),
                field("file", $._filename),
                repeat(field("states", $._state_label)),
                optional(field("position", $._weight_value)),
                repeat($.transition),
                "END",
            ),

        // CHAIN [IF [WEIGHT #weight] trigger THEN] [IF_FILE_EXISTS] entryFile entryLabel chainText
        // (== speaker | BRANCH)* chainEpilogue. The entry condition needs its THEN, unlike a line's.
        chain_action: ($) =>
            seq(
                field("keyword", choice("CHAIN", "CHAIN3")),
                optional(
                    seq(
                        "IF",
                        optional(seq("WEIGHT", field("weight", $._weight_value))),
                        field("trigger", $._string_value),
                        "THEN",
                    ),
                ),
                optional("IF_FILE_EXISTS"),
                field("file", $._filename),
                field("label", $._state_label),
                $.chain_text,
                repeat($._chain_block),
                $.chain_epilogue,
            ),

        // INTERJECT [IF_FILE_EXISTS] entryFile entryLabel globalVar (== speaker | BRANCH)* chainEpilogue
        interject_action: ($) =>
            seq(
                "INTERJECT",
                optional("IF_FILE_EXISTS"),
                field("file", $._filename),
                field("label", $._state_label),
                field("global_var", $._global_var),
                repeat($._chain_block),
                $.chain_epilogue,
            ),

        // INTERJECT_COPY_TRANS[2-4] [SAFE] [IF_FILE_EXISTS] entryFile entryLabel globalVar (== speaker | BRANCH)* END
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
                optional("IF_FILE_EXISTS"),
                field("file", $._filename),
                field("label", $._state_label),
                field("global_var", $._global_var),
                repeat($._chain_block),
                // Plain END, not a chain_epilogue: the construct already implies the copy, so WeiDU
                // gives it no epilogue choice where a bare INTERJECT takes the full set.
                "END",
            ),

        // A global variable name: any string WeiDU's lexer produces, a bare word, ~quoted~ or %var%.
        _global_var: ($) => choice($.identifier, $.string, $.variable_ref),

        // The entry speaker's lines of a CHAIN: `line (= line)*`.
        chain_text: ($) => $._chain_lines,

        // == [IF_FILE_EXISTS] fileName line (= line)*
        chain_speaker: ($) => seq("==", optional("IF_FILE_EXISTS"), field("file", $._filename), $._chain_lines),

        // BRANCH trigger BEGIN (== speaker | BRANCH)* END - the trigger guards every line inside, nested ones too.
        chain_branch: ($) => seq("BRANCH", field("trigger", $._string_value), "BEGIN", repeat($._chain_block), "END"),

        _chain_block: ($) => choice($.chain_speaker, $.chain_branch),

        // One speaker's run of lines. Each line has its own optional condition and DO action, and a line is one
        // text slot, so `~m~ ~f~` is a male and a female text: only `=` starts the next line.
        _chain_lines: ($) => seq($._chain_line, repeat(seq("=", $._chain_line))),

        _chain_line: ($) => seq(optional($._if_trigger_then), field("text", $._text), optional($.do_feature)),

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
        replace_action: ($) => seq("REPLACE", field("file", $._filename), repeat($._state_item), "END"),

        // Text replacement actions. R_A_T is WeiDU's alias for REPLACE_ACTION_TEXT. A regexp file
        // pattern is a string token like any other, so a bare word is one too.
        replace_action_text: replaceTextAction("REPLACE_ACTION_TEXT", "R_A_T"),

        replace_action_text_regexp: replaceTextAction("REPLACE_ACTION_TEXT_REGEXP"),

        replace_action_text_process: replaceTextAction(
            "REPLACE_ACTION_TEXT_PROCESS",
            "REPLACE_ACTION_TEXT_PROCESS_REGEXP",
            "R_A_T_P_R",
        ),

        // ALTER_TRANS filename BEGIN stateNumber list END BEGIN transNumber list END BEGIN changes END [dActionWhen]
        alter_trans: ($) =>
            seq(
                "ALTER_TRANS",
                field("file", $._filename),
                $._state_label_list,
                $._trans_number_list,
                "BEGIN",
                repeat($.alter_trans_change),
                "END",
                repeat($.d_action_when),
            ),

        // A change is `field value`, where field is a WeiDU trans field. It is usually a bareword
        // (ACTION, TRIGGER, EPILOGUE, ...), but REPLY, JOURNAL, SOLVED_JOURNAL, UNSOLVED_JOURNAL and FLAGS are
        // keywords, so those take the quoted form, which any field may use.
        alter_trans_change: ($) => seq(choice($.string, $.identifier, $.variable_ref), $._string_value),

        // Trans replacement actions (using helper)
        replace_trans_trigger: replaceTransAction("REPLACE_TRANS_TRIGGER"),
        replace_trans_action: replaceTransAction("REPLACE_TRANS_ACTION"),

        // REPLACE_TRIGGER_TEXT filename oldText newText [dActionWhen]; R_T_T is its alias.
        replace_trigger_text: ($) =>
            seq(
                kw("REPLACE_TRIGGER_TEXT", "R_T_T"),
                field("file", $._filename),
                field("old_text", $._string_value),
                field("new_text", $._string_value),
                repeat($.d_action_when),
            ),

        // REPLACE_TRIGGER_TEXT_REGEXP filenameRegexp oldText newText [dActionWhen]
        replace_trigger_text_regexp: ($) =>
            seq(
                "REPLACE_TRIGGER_TEXT_REGEXP",
                field("file", $._filename),
                field("old_text", $._string_value),
                field("new_text", $._string_value),
                repeat($.d_action_when),
            ),

        // REPLACE_STATE_TRIGGER filename stateNumber triggerString [moreStateNumbers] [dActionWhen]; R_S_T alias.
        replace_state_trigger: stateTriggerAction(kw("REPLACE_STATE_TRIGGER", "R_S_T")),

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

        // ADD_STATE_TRIGGER filename stateN triggerString [stateN ...] [dActionWhen ...]; A_S_T alias.
        // WeiDU allows the trigger to apply to multiple additional states listed after the trigger
        // string, and takes the IF/UNLESS guards only AFTER those - not between the state and the
        // trigger, a position it rejects.
        add_state_trigger: stateTriggerAction(kw("ADD_STATE_TRIGGER", "A_S_T")),

        // ADD_TRANS_TRIGGER filename stateN triggerString [moreStates] [DO transNumbers] [dActionWhen]; A_T_T alias.
        // An empty DO list is the same as none: every transition gets the trigger. WeiDU parses the list as plain
        // strings and converts each to a number only when it applies the action, so a word there fails the install;
        // an integer slot reports it where it is written.
        add_trans_trigger: stateTriggerAction(kw("ADD_TRANS_TRIGGER", "A_T_T"), ($) =>
            optional(seq("DO", repeat($._integer))),
        ),

        // ADD_TRANS_ACTION filename BEGIN states END BEGIN trans END actionString [dActionWhen]. The guards
        // follow the action string only: WeiDU rejects one before it.
        add_trans_action: ($) =>
            seq(
                "ADD_TRANS_ACTION",
                field("file", $._filename),
                $._state_label_list,
                $._trans_number_list,
                field("action", $._string_value),
                repeat($.d_action_when),
            ),

        // dActionWhen - conditional for D actions
        d_action_when: ($) =>
            choice(seq("IF", field("condition", $._string_value)), seq("UNLESS", field("condition", $._string_value))),

        // What a state list holds: states, plus the two older in-state forms WeiDU still reads.
        _state_item: ($) => choice($.state, $.inline_append, $.inline_chain),

        // IF [WEIGHT #n] ~trigger~ [THEN] [BEGIN] label SAY text [= text...] transitions END
        state: ($) =>
            seq(
                "IF",
                optional(seq("WEIGHT", field("weight", $._weight_value))),
                field("trigger", $._string_value),
                optional("THEN"),
                optional("BEGIN"),
                field("label", $._state_label),
                "SAY",
                field("say", $.say_text),
                repeat($.transition),
                "END",
            ),

        // APPENDI filename state list END, inside a state list: appends the states to another dialog.
        inline_append: ($) => seq("APPENDI", field("file", $._filename), repeat($._state_item), "END"),

        // CHAIN2 entryFile entryLabel text ((= | ==) text)* END exitFile exitLabel, inside a state list: the
        // two-speaker chain that predates CHAIN, where == switches the speaker.
        inline_chain: ($) =>
            seq(
                "CHAIN2",
                field("file", $._filename),
                field("label", $._state_label),
                field("text", $._text),
                repeat(seq(choice("=", "=="), field("text", $._text))),
                "END",
                field("exit_file", $._filename),
                field("exit_label", $._state_label),
            ),

        // SAY text [= text ...]
        say_text: ($) => seq($._text, repeat(seq("=", $._text))),

        // Transitions. A bare %var% here stands in for structure this file never states - its value
        // comes from elsewhere in the install (a variable set in a .tp2 may reach a .d) - and WeiDU
        // has no transition production for a bare string either. Where the preceding say text is
        // itself a string WeiDU absorbs the run instead of erroring, so its silence there is not
        // acceptance. A %var% in a name or text position substitutes a value and stays accepted.
        transition: ($) => choice($.transition_full, $.transition_short, $.copy_trans),

        // IF ~trigger~ [THEN] transFeatures transNext
        transition_full: ($) =>
            seq("IF", field("trigger", $._string_value), optional("THEN"), repeat($._trans_feature), $._trans_next),

        // + [~trigger~] + replyText transFeatures transNext
        transition_short: ($) =>
            seq(
                "+",
                optional(field("trigger", $._string_value)),
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

        do_feature: ($) => seq("DO", field("action", $._string_value)),

        journal_feature: ($) => seq(choice("JOURNAL", "SOLVED_JOURNAL", "UNSOLVED_JOURNAL"), field("text", $._text)),

        flags_feature: ($) => seq("FLAGS", $._integer),

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

        // A weight or a position: `#[-]number`, one token, which WeiDU lexes the same way as a strref.
        _weight_value: ($) => alias($.tlk_ref, $.weight_value),

        // BEGIN...END state label list
        _state_label_list: ($) => seq("BEGIN", repeat(field("state", $._state_label)), "END"),

        // BEGIN...END transaction number list
        _trans_number_list: ($) => seq("BEGIN", repeat($._integer), "END"),

        // An integer slot. WeiDU reads any string token here and converts it, so a number may be written bare, in
        // hex, octal or binary, or quoted (see `number`); a %var% substitutes one.
        _integer: ($) => choice($.number, $.variable_ref),

        // IF trigger [THEN] pattern
        _if_trigger_then: ($) => seq("IF", field("trigger", $._string_value), optional("THEN")),

        // A text slot: a male text with an optional [sound], then an optional female text with its own [sound];
        // or a tra/tlk/AT reference; or `!strref text`, which forces the text into that strref.
        _text: ($) => choice($._text_string, $.compound_text, $.tra_ref, $.tlk_ref, $.at_var_ref, $.forced_text),

        // A text written out: one string or a `^`-joined run, a %var% included (see `_string_value`), as in
        // `CHAIN ... %kivan17%`, which OUTER_SPRINT sets to a strref.
        _text_string: ($) => choice($._string_value, $.concat_string),

        concat_string: ($) => seq($._string_value, repeat1(seq("^", $._string_value))),

        compound_text: ($) =>
            choice(
                seq(field("male", $._text_string), field("male_sound", $.sound)),
                seq(
                    field("male", $._text_string),
                    optional(field("male_sound", $.sound)),
                    field("female", $._text_string),
                    optional(field("female_sound", $.sound)),
                ),
            ),

        forced_text: ($) => seq(field("strref", $.forced_strref), field("text", $._text)),

        forced_strref: ($) => token(seq("!", optional("-"), /[0-9]+/)),

        sound: ($) => token(seq("[", /[^\]]*/, "]")),

        // String literals. A five-tilde string may hold single tildes.
        string: ($) => choice($.tilde_string, $.double_string, $.five_tilde_string),

        // A slot WeiDU fills with a plain string: a trigger, an action, a text, a patch action's old and new text.
        // WeiDU lexes a bare word and a %...% run as the same string token as a quoted one, so both are strings here
        // (a keyword is not: it is reserved). A %var% substitutes the whole value, a trigger or an action included;
        // only a %var% standing for structure, such as a whole transition, has no slot. Name and label slots take
        // identifiers and variables on their own terms instead.
        _string_value: ($) => choice($.string, alias($.identifier, $.string), $.variable_ref),

        tilde_string: ($) => seq("~", optional($.tilde_content), "~"),

        double_string: ($) => seq('"', optional($.double_content), '"'),

        five_tilde_string: ($) => seq("~~~~~", optional($.five_tilde_content), "~~~~~"),

        // References
        tra_ref: ($) => token(seq("@", optional("-"), /[0-9]+/)),
        tlk_ref: ($) => token(seq("#", optional("-"), /[0-9]+/)),
        at_var_ref: ($) => seq("(", "AT", choice($.string, $.variable_ref, $.identifier), ")"),

        // WeiDU variable reference %name%. WeiDU reads to the next %, whatever lies between; this stops at
        // whitespace, as the TP2 grammar does, so a % still being typed cannot run on to the next % lines away.
        variable_ref: ($) => token(seq("%", /[^%\s]*/, "%")),

        // Basic tokens. The one identifier-shaped token in the grammar: it also carries state labels
        // (aliased at _state_label), and its shape is WeiDU's own bare-word token, which WeiDU matches
        // before looking the text up as a keyword - the same two steps `word:` above sets up. # is
        // namespacing (RR#INT01); labels contribute the leading digit (4a, 100), the dots (KHPC1.1)
        // and the hyphens (Quayle_Shar-Teel_1). `number` is integer-only, so a dotted run is a label,
        // never a float. Splitting these back into two narrower tokens is what made the lexer big.
        identifier: ($) => /[A-Za-z0-9_][A-Za-z0-9_#.-]*/,

        // Higher lexical precedence than `identifier`, which also matches a digit run now that it
        // carries state labels. Where both are admissible - the non-pausing flag after `BEGIN file`,
        // a BEGIN/END number list - a bare digit run has to lex as the number, or the word token wins
        // and the number position never matches. WeiDU has no number token at all here: it lexes any
        // string token and converts it to an integer where one is wanted, so the integer forms that
        // conversion takes are a number written bare (a bare word cannot start with a sign) or quoted.
        // Only integer slots admit this token, and none of them admits a string, so `~4~` never competes
        // with a string's opening tilde.
        number: ($) =>
            token(
                prec(
                    1,
                    choice(
                        INTEGER,
                        seq("~", SIGNED_INTEGER, "~"),
                        seq('"', SIGNED_INTEGER, '"'),
                        seq("~~~~~", SIGNED_INTEGER, "~~~~~"),
                    ),
                ),
            ),

        // comment is produced by the external scanner (nesting); only line_comment is internal.
        line_comment: ($) => seq("//", /[^\n]*/),
    },
});
