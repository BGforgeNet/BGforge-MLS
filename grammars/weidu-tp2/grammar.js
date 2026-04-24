/**
 * Tree-sitter grammar for WeiDU TP2 files.
 * Covers .tp2 (full), .tpa/.tph (actions), .tpp (patches).
 *
 * @file WeiDU TP2 grammar
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// =========================================
// HELPER FUNCTIONS
// =========================================

/** choice() that handles single keyword without warning */
const kw = (...keywords) => (keywords.length === 1 ? keywords[0] : choice(...keywords));

/** Read patch: KEYWORD offset var [ELSE value] */
const readPatch =
    (...keywords) =>
    ($) =>
        seq(
            kw(...keywords),
            field("offset", $.value),
            field("var", $._assignable),
            optional(seq("ELSE", field("else_value", $.value))),
        );

/** Write patch: KEYWORD offset value */
const writePatch =
    (...keywords) =>
    ($) =>
        seq(kw(...keywords), field("offset", $.value), field("value", $.value));

/** Memory access expression: KEYWORD offset */
const memoryAt =
    (...keywords) =>
    ($) =>
        seq(kw(...keywords), field("offset", $.value));

/** Check expression: KEYWORD value (with prec.right(3)) */
const checkExpr =
    (keyword, fieldName = "value") =>
    ($) =>
        prec.right(3, seq(keyword, field(fieldName, $.value)));

/** Sprint-like operation: KEYWORD var value */
const sprintOp =
    (...keywords) =>
    ($) =>
        seq(kw(...keywords), field("var", $.value), field("value", $.value));

/** Sprint-like operation with optional GLOBAL: KEYWORD [GLOBAL] var value */
const sprintOpGlobal =
    (...keywords) =>
    ($) =>
        seq(kw(...keywords), optional("GLOBAL"), field("var", $.value), field("value", $.value));

/** Sprintf-like operation: KEYWORD var format [(args...)] */
const sprintfOp = (keyword) => ($) =>
    prec.right(seq(keyword, field("var", $.value), field("format", $.value), optional(seq("(", repeat($.value), ")"))));

/** Print-like operation: KEYWORD message */
const printOp = (keyword) => ($) => seq(keyword, field("message", $.value));

/** Case conversion: KEYWORD var (identifier only) */
const caseConvert = (keyword) => ($) => seq(keyword, field("var", $.identifier));

/** CRE/store item patch: KEYWORD values... */
const itemPatch = (keyword) => ($) => seq(keyword, repeat1($.value));

/** EXTEND action: KEYWORD existing new_file [EVAL] patches... */
const extendAction = (keyword) => ($) =>
    prec.right(
        seq(
            keyword,
            field("existing", $.value),
            field("new_file", $.value),
            optional(choice("EVALUATE_BUFFER", "EVAL")),
            repeat($._patch),
        ),
    );

/** APPEND action: KEYWORD [+/-] file text [when] [KEEP_CRLF] */
const appendAction = (keyword) => ($) =>
    seq(
        keyword,
        optional($._opt_no_backup),
        field("file", $.value),
        field("text", $.value),
        optional($.when),
        optional("KEEP_CRLF"),
    );

/** Define macro: KEYWORD name BEGIN body END (body can include LOCAL_SET/LOCAL_SPRINT) */
const defineMacro = (keyword, bodyType) => ($) =>
    seq(
        keyword,
        field("name", choice($.identifier, $.string)),
        "BEGIN",
        repeat(choice(bodyType($), $.local_set, $.local_sprint)),
        "END",
    );

/** Define function: KEYWORD name params BEGIN body END */
const defineFunction = (keyword, bodyType) => ($) =>
    seq(
        keyword,
        field("name", choice($.identifier, $.string)),
        repeat($._func_decl_param),
        "BEGIN",
        repeat(bodyType($)),
        "END",
    );

/** FOR loop: FOR (init; cond; step) BEGIN body END */
const forLoop = (keyword, bodyType) => ($) =>
    seq(
        keyword,
        "(",
        repeat($._patch),
        ";",
        field("condition", $.value),
        ";",
        repeat($._patch),
        ")",
        "BEGIN",
        repeat(bodyType($)),
        "END",
    );

/** WHILE loop: WHILE cond BEGIN body END */
const whileLoop = (keyword, bodyType) => ($) =>
    seq(keyword, field("condition", $.value), "BEGIN", repeat(bodyType($)), "END");

/** PHP_EACH loop: KEYWORD array AS key => value BEGIN body END */
const phpEachLoop =
    (...keywords) =>
    (bodyType) =>
    ($) =>
        seq(
            kw(...keywords),
            field("array", $.value),
            "AS",
            field("key_var", $.identifier),
            "=>",
            field("value_var", $.identifier),
            "BEGIN",
            repeat(bodyType($)),
            "END",
        );

/** Index expression: KEYWORD ( [flags] needle haystack [start] ) */
const indexExpr =
    (keyword, hasHaystack = true) =>
    ($) =>
        seq(
            keyword,
            "(",
            optional($.search_flags),
            field("needle", $.value),
            ...(hasHaystack ? [field("haystack", $.value)] : []),
            optional(field("start", $.value)),
            ")",
        );

/** OUTER_PATCH action: KEYWORD buffer BEGIN patches END */
const outerPatchAction = (keyword) => ($) => seq(keyword, field("buffer", $.value), "BEGIN", repeat($._patch), "END");

/** OUTER_PATCH_SAVE action: KEYWORD var buffer BEGIN patches END */
const outerPatchSaveAction = (keyword) => ($) =>
    seq(keyword, field("var", $._assignable), field("buffer", $.value), "BEGIN", repeat($._patch), "END");

/** INNER_PATCH: KEYWORD buffer BEGIN patches END */
const innerPatchOp = (keyword) => ($) => seq(keyword, field("buffer", $.value), "BEGIN", repeat($._patch), "END");

/** TRY block: KEYWORD body WITH [DEFAULT] handler END */
const tryBlock = (keyword, bodyType) => ($) =>
    seq(keyword, repeat(bodyType($)), "WITH", optional("DEFAULT"), repeat(bodyType($)), "END");

/** DEFINE_ASSOCIATIVE_ARRAY: KEYWORD name BEGIN entries END */
const defineAssocArray =
    (...keywords) =>
    ($) =>
        seq(kw(...keywords), field("name", $.value), "BEGIN", repeat($.assoc_entry), "END");

/** CLEAR_ARRAY: KEYWORD array */
const clearArray = (keyword) => ($) => seq(keyword, field("array", $.value));

/** GET_STRREF: KEYWORD strref var */
const getStrref =
    (...keywords) =>
    ($) =>
        seq(kw(...keywords), field("strref", $.value), field("var", $.identifier));

export default grammar({
    name: "weidu_tp2",

    extras: ($) => [/\s/, $.comment, $.line_comment],

    word: ($) => $.identifier,

    conflicts: ($) => [
        [$._expr, $._simple_expr],
        [$.component],
        [$.action_copy],
        [$.action_copy_existing],
        [$.action_copy_existing_regexp],
        [$.action_create],
        [$.variable_ref, $._assignable],
        [$.variable_ref, $.action_at_now],
        [$.variable_ref, $.action_at_interactive_now],
        [$.variable_ref, $.assoc_entry],
        [$.patch_remove_store_item],
        [$.patch_add_store_item],
        [$.patch_replace_cre_item],
        [$.patch_remove_cre_item],
        [$.patch_add_cre_item],
        [$.action_copy_all_gam_files],
        [$.action_copy_random],
        [$.action_match_case],
        [$._action, $._top_level],
        [$._assignable],
        [$._assignable, $._primary],
        [$._assignable, $._expr],
        [$.patch_define_associative_array, $.action_define_associative_array],
        [$.patch_evaluate_buffer, $.action_extend_top],
        [$.patch_evaluate_buffer, $.action_extend_bottom],
        [$._action, $.action_if],
    ],

    rules: {
        // First token disambiguates: normal file (.tp2) vs patch-only file (.tpp)
        source_file: ($) =>
            choice(
                // TP2 file - prologue first (optional for error recovery), then everything else
                seq(
                    // Prologue (should come first if present - optional for malformed files)
                    optional($.backup_directive),
                    optional(choice($.author_directive, $.support_directive)),
                    // Everything else (flags, languages, components, actions)
                    repeat(choice($._top_level, $._action)),
                ),
                // Patch-only file (.tpp)
                $.patch_file,
            ),

        // Patch-only file (e.g., .tpp includes) - entire file is patches
        patch_file: ($) => repeat1($._patch),

        // =========================================
        // LITERALS
        // =========================================

        string: ($) => choice($.tilde_string, $.double_string, $.five_tilde_string, $.percent_string),

        tilde_string: ($) => seq("~", optional($.tilde_content), "~"),
        tilde_content: ($) => /[^~]+/,

        double_string: ($) => seq('"', optional($.double_content), '"'),
        double_content: ($) => /[^"]*/,

        five_tilde_string: ($) => seq("~~~~~", optional($.five_tilde_content), "~~~~~"),
        five_tilde_content: ($) => repeat1(choice(/[^~]+/, /~{1,4}/)),

        percent_string: ($) => seq("%", $.percent_content, "%"),
        percent_content: ($) => /[^%]+/,

        // Decimal, hex (0x), octal (0o), binary (0b), # prefix, dotted version
        number: ($) => choice(/-?[0-9]+(\.[0-9]+)*/, /0[xX][0-9a-fA-F]+/, /0[oO][0-7]+/, /0[bB][01]+/, /#-?[0-9]+/),

        tra_ref: ($) => /@-?[0-9]+/,

        identifier: ($) => /[A-Za-z_][A-Za-z0-9_#-]*/,

        // Unquoted resource reference (e.g., script.bcs, 00MYFILE.itm)
        bare_resref: ($) => /[A-Za-z0-9_][A-Za-z0-9_#-]*\.[A-Za-z0-9]+/,

        // =========================================
        // COMMENTS
        // =========================================

        comment: ($) => seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/"),
        line_comment: ($) => seq("//", /[^\n]*/),

        // =========================================
        // VARIABLE REFERENCES
        // =========================================

        variable_ref: ($) =>
            choice($.identifier, $.var_name_numeric, seq("%", choice($.identifier, $.var_name_numeric), "%")),

        // Variable name starting with a number (valid inside %...% and as array keys)
        var_name_numeric: ($) => /[0-9][A-Za-z0-9_#-]*/,

        array_access: ($) =>
            choice(
                seq("$", field("name", choice($.identifier, $.string)), "(", repeat($.value), ")"),
                seq("$", "EVAL", field("name", $.value), "(", repeat($.value), ")"),
            ),

        // EVAL allows evaluated variable names (e.g., EVAL $array(...))
        _assignable: ($) => seq(optional("EVAL"), choice($.identifier, $.var_name_numeric, $.array_access, $.string)),

        // =========================================
        // MODIFIERS / FLAGS
        // =========================================

        _opt_no_backup: ($) => prec(10, choice("+", "-")),
        _opt_glob: ($) => choice("GLOB", "NOGLOB"),
        _opt_case: ($) => choice("CASE_SENSITIVE", "CASE_INSENSITIVE"),
        _opt_exact: ($) => choice("EXACT_MATCH", "EVALUATE_REGEXP"),
        _opt_caching: ($) => choice("CACHE", "CLEAR"),
        search_flags: ($) => repeat1(choice($._opt_case, $._opt_exact)),

        // =========================================
        // EXPRESSIONS (VALUES)
        // =========================================

        // Named node for expression context detection in completions
        value: ($) => $._expr,

        // Simple value excludes OR/AND binary expressions - used where boolean operators shouldn't appear
        simple_value: ($) => $._simple_expr,

        _expr: ($) =>
            choice(
                $.ternary_expr,
                $.binary_expr,
                $.unary_expr,
                $.paren_expr,
                $.evaluated_expr,
                // Memory access
                $.byte_at_expr,
                $.short_at_expr,
                $.long_at_expr,
                // Function-like expressions
                $.index_expr,
                $.rindex_expr,
                $.index_buffer_expr,
                $.rindex_buffer_expr,
                $.random_expr,
                $.ids_of_symbol_expr,
                $.resolve_str_ref_expr,
                $.state_which_says_expr,
                $.tra_entry_exists_expr,
                // Check expressions
                $.file_exists_expr,
                $.file_exists_in_game_expr,
                $.directory_exists_expr,
                $.file_is_in_compressed_biff_expr,
                $.file_size_expr,
                $.file_md5_expr,
                $.variable_is_set_expr,
                $.is_an_int_expr,
                $.game_is_expr,
                $.game_includes_expr,
                $.engine_is_expr,
                $.mod_is_installed_expr,
                $.id_of_label_expr,
                $.file_contains_expr,
                $.file_contains_evaluated_expr,
                $.string_length_expr,
                $.variable_is_in_array_expr,
                $.defined_as_function_expr,
                $.defined_as_inlined_expr,
                // Nullary expressions
                $.nullary_expr,
                $.array_access,
                $._primary,
            ),

        // Simple expression excludes OR/AND - only comparison and arithmetic binary ops
        _simple_expr: ($) =>
            choice(
                $.ternary_expr,
                $._simple_binary_expr,
                $.unary_expr,
                $.paren_expr,
                $.evaluated_expr,
                // Memory access
                $.byte_at_expr,
                $.short_at_expr,
                $.long_at_expr,
                // Function-like expressions
                $.index_expr,
                $.rindex_expr,
                $.index_buffer_expr,
                $.rindex_buffer_expr,
                $.random_expr,
                $.ids_of_symbol_expr,
                $.resolve_str_ref_expr,
                $.state_which_says_expr,
                $.tra_entry_exists_expr,
                // Check expressions
                $.file_exists_expr,
                $.file_exists_in_game_expr,
                $.directory_exists_expr,
                $.file_is_in_compressed_biff_expr,
                $.file_size_expr,
                $.file_md5_expr,
                $.variable_is_set_expr,
                $.is_an_int_expr,
                $.game_is_expr,
                $.game_includes_expr,
                $.engine_is_expr,
                $.mod_is_installed_expr,
                $.id_of_label_expr,
                $.file_contains_expr,
                $.file_contains_evaluated_expr,
                $.string_length_expr,
                $.variable_is_in_array_expr,
                $.defined_as_function_expr,
                $.defined_as_inlined_expr,
                // Nullary expressions
                $.nullary_expr,
                $.array_access,
                $._primary,
            ),

        // Binary expression without OR/AND
        _simple_binary_expr: ($) =>
            choice(
                prec.left(
                    2,
                    seq(field("left", $._simple_expr), field("op", $._comparison_op), field("right", $._simple_expr)),
                ),
                prec.left(
                    3,
                    seq(field("left", $._simple_expr), field("op", $._arithmetic_op), field("right", $._simple_expr)),
                ),
            ),

        _primary: ($) => choice($.string, $.number, $.tra_ref, $.at_ref, $.bare_resref, $.variable_ref),

        at_ref: ($) => prec.right(3, seq("AT", field("ref", $._expr))),

        paren_expr: ($) => seq("(", $._expr, ")"),

        ternary_expr: ($) =>
            prec.right(1, seq(field("condition", $._expr), "?", field("then", $._expr), ":", field("else", $._expr))),

        binary_expr: ($) =>
            choice(
                prec.left(
                    1,
                    seq(field("left", $._expr), field("op", choice("AND", "OR", "&&", "||")), field("right", $._expr)),
                ),
                prec.left(2, seq(field("left", $._expr), field("op", $._comparison_op), field("right", $._expr))),
                prec.left(3, seq(field("left", $._expr), field("op", $._arithmetic_op), field("right", $._expr))),
            ),

        _comparison_op: ($) =>
            choice(
                "==",
                "=",
                "!=",
                "<",
                ">",
                "<=",
                ">=",
                "EQUALS",
                "STRING_COMPARE",
                "STR_CMP",
                "STRING_COMPARE_CASE",
                "STRING_EQUAL",
                "STRING_EQUAL_CASE",
                "STR_EQ",
                "STRING_MATCHES_REGEXP",
                "STRING_CONTAINS_REGEXP",
                "STRING_COMPARE_REGEXP",
            ),

        _arithmetic_op: ($) =>
            choice(
                "+",
                "-",
                "*",
                "/",
                "**",
                "MODULO",
                "REM",
                "BAND",
                "BOR",
                "BXOR",
                "&",
                "|",
                "^^",
                "BLSL",
                "BLSR",
                "BASR",
                "<<",
                ">>",
                "^",
            ),

        unary_expr: ($) => prec.right(3, seq(field("op", $._unary_op), field("operand", $._expr))),

        _unary_op: ($) => choice("-", "NOT", "!", "BNOT", "`", "ABS"),

        evaluated_expr: ($) => prec.right(1, seq(choice("EVAL", "EVALUATE_BUFFER"), field("value", $._expr))),

        // Memory access expressions
        byte_at_expr: memoryAt("BYTE_AT", "SBYTE_AT"),
        short_at_expr: memoryAt("SHORT_AT", "SSHORT_AT"),
        long_at_expr: memoryAt("LONG_AT", "SLONG_AT"),

        // Index expressions
        index_expr: indexExpr("INDEX"),
        rindex_expr: indexExpr("RINDEX"),
        index_buffer_expr: indexExpr("INDEX_BUFFER", false),
        rindex_buffer_expr: indexExpr("RINDEX_BUFFER", false),

        random_expr: ($) => seq("RANDOM", "(", field("lower", $.value), field("upper", $.value), ")"),

        ids_of_symbol_expr: ($) => seq("IDS_OF_SYMBOL", "(", field("file", $.value), field("symbol", $.value), ")"),

        resolve_str_ref_expr: ($) => seq("RESOLVE_STR_REF", "(", field("text", $.value), ")"),

        state_which_says_expr: ($) =>
            prec.right(
                3,
                seq(
                    "STATE_WHICH_SAYS",
                    field("text", $.value),
                    optional(seq("IN", field("in_dlg", $.value))),
                    "FROM",
                    field("from_dlg", $.value),
                ),
            ),

        tra_entry_exists_expr: ($) =>
            seq("TRA_ENTRY_EXISTS", "(", field("entry", $.value), repeat(field("file", $.value)), ")"),

        // Check expressions
        file_exists_expr: checkExpr("FILE_EXISTS", "file"),
        file_exists_in_game_expr: checkExpr("FILE_EXISTS_IN_GAME", "file"),
        directory_exists_expr: checkExpr("DIRECTORY_EXISTS", "dir"),
        file_is_in_compressed_biff_expr: checkExpr("FILE_IS_IN_COMPRESSED_BIFF", "file"),
        file_size_expr: ($) => prec.right(3, seq("FILE_SIZE", field("file", $.value), field("size", $.value))),
        file_md5_expr: ($) => prec.right(3, seq("FILE_MD5", field("file", $.value), field("md5", $.value))),
        variable_is_set_expr: ($) =>
            prec.right(3, seq("VARIABLE_IS_SET", optional(choice("EVAL", "EVALUATE_BUFFER")), field("var", $.value))),
        is_an_int_expr: checkExpr("IS_AN_INT", "var"),
        game_is_expr: ($) => prec.right(3, seq("GAME_IS", optional($._opt_caching), field("games", $.value))),
        game_includes_expr: ($) =>
            prec.right(3, seq("GAME_INCLUDES", optional($._opt_caching), field("games", $.simple_value))),
        engine_is_expr: ($) =>
            prec.right(3, seq("ENGINE_IS", optional($._opt_caching), field("engines", $.simple_value))),
        string_length_expr: checkExpr("STRING_LENGTH", "string"),

        variable_is_in_array_expr: checkExpr("VARIABLE_IS_IN_ARRAY", "array"),
        defined_as_function_expr: checkExpr("DEFINED_AS_FUNCTION", "var"),
        defined_as_inlined_expr: checkExpr("DEFINED_AS_INLINED", "var"),

        mod_is_installed_expr: ($) =>
            prec.right(
                3,
                seq(
                    choice("MOD_IS_INSTALLED", "COMPONENT_IS_INSTALLED"),
                    field("mod", $.value),
                    field("component", $.simple_value),
                ),
            ),

        id_of_label_expr: ($) => seq("ID_OF_LABEL", field("tp2", $.value), field("label", $.value)),

        file_contains_expr: ($) =>
            prec.right(3, seq("FILE_CONTAINS", field("file", $.value), field("regexp", $.value))),

        file_contains_evaluated_expr: ($) =>
            seq("FILE_CONTAINS_EVALUATED", "(", field("file", $.value), field("regexp", $.value), ")"),

        nullary_expr: ($) =>
            choice(
                "BUFFER_LENGTH",
                "NEXT_STRREF",
                "IS_SILENT",
                "SOURCE_SIZE",
                "SOURCE_RES",
                "SOURCE_EXT",
                "SOURCE_FILE",
                "SOURCE_DIRECTORY",
                "SOURCE_FILESPEC",
                "DEST_RES",
                "DEST_EXT",
                "DEST_FILE",
                "DEST_DIRECTORY",
                "DEST_FILESPEC",
            ),

        // =========================================
        // PATCHES
        // =========================================

        _patch: ($) =>
            choice(
                // Write operations
                $.patch_write_byte,
                $.patch_write_short,
                $.patch_write_long,
                $.patch_write_ascii,
                $.patch_write_ascii_list,
                $.patch_write_asciil,
                // Read operations
                $.patch_read_byte,
                $.patch_read_short,
                $.patch_read_long,
                $.patch_read_ascii,
                $.patch_read_strref,
                $.patch_get_strref,
                $.patch_lookup_ids_symbol_of_int,
                // String operations
                $.patch_say,
                $.patch_sprint,
                $.patch_text_sprint,
                $.patch_snprint,
                $.patch_sprintf,
                $.patch_to_upper,
                $.patch_to_lower,
                $.patch_spaces,
                $.patch_quote,
                $.patch_source_biff,
                // Assignment
                $.patch_set,
                $.patch_assignment,
                $.patch_increment,
                $.patch_decrement,
                // Control flow
                $.patch_if,
                $.patch_match,
                $.patch_for,
                $.patch_while,
                $.patch_php_each,
                $.patch_for_each,
                $.patch_with_scope,
                // Text manipulation
                $.patch_replace,
                $.patch_replace_textually,
                $.patch_replace_evaluate,
                // Buffer operations
                $.patch_evaluate_buffer,
                $.patch_insert_bytes,
                $.patch_delete_bytes,
                $.patch_append_file,
                // 2DA operations
                $.patch_read_2da_entry,
                $.patch_read_2da_entries_now,
                $.patch_read_2da_entry_former,
                $.patch_set_2da_entry,
                $.patch_set_2da_entry_later,
                $.patch_set_2da_entries_now,
                $.patch_count_2da_cols,
                $.patch_count_2da_rows,
                $.patch_count_regexp_instances,
                $.patch_pretty_print_2da,
                $.patch_insert_2da_row,
                $.patch_remove_2da_row,
                // Offset array operations
                $.patch_get_offset_array,
                $.patch_get_offset_array2,
                // Store operations
                $.patch_remove_store_item,
                $.patch_add_store_item,
                // CRE item operations
                $.patch_replace_cre_item,
                $.patch_remove_cre_item,
                $.patch_add_cre_item,
                $.patch_add_memorized_spell,
                $.patch_remove_memorized_spell,
                $.patch_remove_memorized_spells,
                $.patch_add_known_spell,
                $.patch_remove_known_spell,
                $.patch_remove_known_spells,
                $.patch_remove_cre_effects,
                $.patch_add_map_note,
                $.patch_set_bg2_proficiency,
                // Functions
                $.patch_launch_function,
                $.patch_launch_macro,
                $.patch_replace_bcs_block,
                // Arrays
                $.patch_define_array,
                $.patch_define_associative_array,
                $.patch_clear_array,
                $.patch_sort_array_indices,
                // Exception handling
                $.patch_try,
                // Inner patches
                $.inner_patch,
                $.inner_patch_save,
                $.inner_patch_file,
                $.inner_action,
                // Misc
                $.patch_print,
                $.patch_log,
                $.patch_warn,
                $.patch_fail,
                $.patch_abort,
                $.patch_include,
                $.patch_reraise,
                $.patch_silent,
                $.patch_verbose,
                $.patch_compile_baf_to_bcs,
                $.patch_decompile_bcs_to_baf,
                $.patch_compile_d_to_dlg,
                $.patch_decompile_dlg_to_d,
                $.patch_decompile_and_patch,
                $.patch_decompress_replace_file,
                $.patch_compress_replace_file,
                $.patch_decompress_into_var,
            ),

        // Write patches
        patch_write_byte: writePatch("WRITE_BYTE"),
        patch_write_short: writePatch("WRITE_SHORT"),
        patch_write_long: writePatch("WRITE_LONG"),

        patch_write_ascii: ($) =>
            prec.right(
                seq(
                    choice(
                        "WRITE_ASCII",
                        "WRITE_ASCIIE",
                        "WRITE_ASCIIT",
                        "WRITE_ASCII_TERMINATE",
                        "WRITE_EVALUATED_ASCII",
                    ),
                    field("offset", $.value),
                    field("string", $.value),
                    optional(choice(seq("#", field("length", $.value)), seq("(", field("length", $.value), ")"))),
                ),
            ),

        patch_write_ascii_list: ($) => prec.right(seq("WRITE_ASCII_LIST", field("offset", $.value), repeat1($.value))),

        patch_write_asciil: ($) => prec.right(seq("WRITE_ASCIIL", field("offset", $.value), repeat1($.value))),

        // Read patches
        patch_read_byte: readPatch("READ_BYTE", "READ_SBYTE"),
        patch_read_short: readPatch("READ_SHORT", "READ_SSHORT"),
        patch_read_long: readPatch("READ_LONG", "READ_SLONG"),

        patch_read_ascii: ($) =>
            prec.right(
                seq(
                    "READ_ASCII",
                    field("offset", $.value),
                    field("var", $.value),
                    optional(seq("ELSE", field("else_value", $.value))),
                    optional(seq("(", field("length", $.value), ")")),
                    optional("NULL"),
                ),
            ),

        patch_read_strref: ($) =>
            seq(
                choice("READ_STRREF", "READ_STRREF_F", "READ_STRREF_S", "READ_STRREF_FS"),
                field("offset", $.value),
                field("var", $.identifier),
                optional(seq("ELSE", field("default", $.value))),
            ),

        patch_get_strref: getStrref("GET_STRREF", "GET_STRREF_S"),

        patch_lookup_ids_symbol_of_int: ($) =>
            seq(
                "LOOKUP_IDS_SYMBOL_OF_INT",
                field("target", $.identifier),
                field("ids_file", $.value),
                field("value", $.value),
            ),

        // String operations
        // SAY offset text [sound] [female_text [female_sound]]
        // When female_text is provided, first text is for male PC, second for female PC
        patch_say: ($) =>
            prec.right(
                seq(
                    choice("SAY", "SAY_EVALUATED"),
                    field("offset", $.value),
                    field("text", $.value),
                    optional($.sound_ref),
                    optional(seq(field("female_text", $.value), optional($.sound_ref))),
                ),
            ),

        patch_sprint: sprintOpGlobal("SPRINT"),
        patch_text_sprint: sprintOpGlobal("TEXT_SPRINT"),

        patch_snprint: ($) =>
            seq("SNPRINT", field("length", $.value), field("var", $.identifier), field("value", $.value)),

        patch_sprintf: sprintfOp("SPRINTF"),

        patch_to_upper: caseConvert("TO_UPPER"),
        patch_to_lower: caseConvert("TO_LOWER"),

        patch_spaces: ($) => seq("SPACES", field("var", $.identifier), field("template", $.value)),
        patch_quote: ($) => seq("QUOTE", field("var", $.identifier), field("string", $.value)),
        patch_source_biff: ($) => seq("SOURCE_BIFF", field("var", $.identifier), field("filename", $.value)),

        // Assignment
        patch_set: ($) =>
            seq(
                "SET",
                optional(choice("EVAL", "EVALUATE_BUFFER", "GLOBAL")),
                field("var", $._assignable),
                $._assign_op,
                field("value", $.value),
            ),

        patch_assignment: ($) => prec(10, seq(field("var", $._assignable), $._assign_op, field("value", $.value))),

        patch_increment: ($) => seq("++", field("var", $.value)),
        patch_decrement: ($) => seq("--", field("var", $.value)),

        _assign_op: ($) => choice("=", "+=", "-=", "*=", "/=", "|=", "&=", "||=", "&&="),

        // Control flow
        patch_if: ($) =>
            seq(
                "PATCH_IF",
                field("condition", $.value),
                optional("THEN"),
                "BEGIN",
                repeat($._patch),
                "END",
                optional(
                    seq(
                        "ELSE",
                        choice(
                            seq("BEGIN", repeat($._patch), "END"),
                            $._patch, // else-if chain or single patch
                        ),
                    ),
                ),
            ),

        patch_match: ($) =>
            seq(
                "PATCH_MATCH",
                field("value", $.value),
                "WITH",
                repeat($.match_case),
                "DEFAULT",
                repeat($._patch),
                "END",
            ),

        match_case: ($) =>
            seq(repeat1($.value), optional(seq("WHEN", field("guard", $.value))), "BEGIN", repeat($._patch), "END"),

        patch_for: forLoop("FOR", ($) => $._patch),
        patch_while: whileLoop("WHILE", ($) => $._patch),
        patch_php_each: phpEachLoop("PHP_EACH", "PATCH_PHP_EACH")(($) => $._patch),

        patch_for_each: ($) =>
            seq("PATCH_FOR_EACH", field("var", $.value), "IN", repeat1($.value), "BEGIN", repeat($._patch), "END"),

        patch_with_scope: ($) => seq("PATCH_WITH_SCOPE", "BEGIN", repeat($._patch), "END"),

        // Text manipulation
        patch_replace: ($) =>
            seq("REPLACE", field("regexp", $.value), field("replacement", $.value), optional($.sound_ref)),

        // Sound reference: [sound_name] or [%variable%]
        // Higher precedence to prefer identifier over variable_ref for bare names
        sound_ref: ($) => prec(5, seq("[", field("sound", choice($.identifier, $.variable_ref)), "]")),

        patch_replace_textually: ($) =>
            prec.right(
                seq(
                    "REPLACE_TEXTUALLY",
                    optional($.search_flags),
                    field("regexp", $.value),
                    field("replacement", $.value),
                    optional(seq("(", field("count", $.value), ")")),
                ),
            ),

        patch_replace_evaluate: ($) =>
            seq(
                "REPLACE_EVALUATE",
                optional($.search_flags),
                field("regexp", $.value),
                "BEGIN",
                repeat($._patch),
                "END",
                field("replacement", $.value),
            ),

        // Buffer operations
        patch_evaluate_buffer: ($) => "EVALUATE_BUFFER",

        patch_insert_bytes: ($) => seq("INSERT_BYTES", field("offset", $.value), field("length", $.value)),

        patch_delete_bytes: ($) => seq("DELETE_BYTES", field("offset", $.value), field("length", $.value)),

        patch_append_file: ($) => seq("APPEND_FILE", field("file", $.value)),

        // 2DA operations
        patch_read_2da_entry: ($) =>
            seq(
                "READ_2DA_ENTRY",
                field("row", $.value),
                field("col", $.value),
                field("req_cols", $.value),
                field("var", $.value),
            ),

        patch_read_2da_entries_now: ($) =>
            seq("READ_2DA_ENTRIES_NOW", field("var", $.value), field("req_cols", $.value)),

        patch_read_2da_entry_former: ($) =>
            seq(
                "READ_2DA_ENTRY_FORMER",
                field("array", $.value),
                field("row", $.value),
                field("col", $.value),
                field("var", $.value),
            ),

        patch_set_2da_entry: ($) =>
            seq(
                "SET_2DA_ENTRY",
                field("row", $.value),
                field("col", $.value),
                field("req_cols", $.value),
                field("value", $.value),
            ),

        patch_set_2da_entry_later: ($) =>
            seq(
                "SET_2DA_ENTRY_LATER",
                field("array", $.value),
                field("row", $.value),
                field("col", $.value),
                field("value", $.value),
            ),

        patch_set_2da_entries_now: ($) =>
            seq("SET_2DA_ENTRIES_NOW", field("array", $.value), field("req_cols", $.value)),

        patch_count_2da_cols: ($) => seq("COUNT_2DA_COLS", field("var", choice($.identifier, $.string))),

        patch_count_2da_rows: ($) =>
            seq("COUNT_2DA_ROWS", field("req_cols", $.value), field("var", choice($.identifier, $.string))),

        patch_count_regexp_instances: ($) =>
            seq(
                "COUNT_REGEXP_INSTANCES",
                optional("CASE_SENSITIVE"),
                optional("EXACT_MATCH"),
                field("pattern", $.value),
                field("var", $.value),
            ),

        patch_pretty_print_2da: ($) => "PRETTY_PRINT_2DA",

        patch_insert_2da_row: ($) =>
            seq("INSERT_2DA_ROW", field("row", $.value), field("req_cols", $.value), field("value", $.value)),

        patch_remove_2da_row: ($) => seq("REMOVE_2DA_ROW", field("row", $.value), field("req_cols", $.value)),

        patch_get_offset_array: ($) =>
            prec.right(seq("GET_OFFSET_ARRAY", field("var", $.identifier), repeat1($.value))),

        patch_get_offset_array2: ($) =>
            prec.right(seq("GET_OFFSET_ARRAY2", field("var", $.identifier), repeat1($.value))),

        // Store/CRE item operations (using helpers)
        patch_remove_store_item: ($) => seq("REMOVE_STORE_ITEM", repeat1(field("item", $.value))),

        patch_add_store_item: ($) => seq("ADD_STORE_ITEM", optional($._opt_no_backup), repeat1(field("item", $.value))),

        patch_replace_cre_item: itemPatch("REPLACE_CRE_ITEM"),
        patch_remove_cre_item: itemPatch("REMOVE_CRE_ITEM"),
        patch_add_cre_item: itemPatch("ADD_CRE_ITEM"),

        patch_add_memorized_spell: ($) =>
            prec.right(
                seq(
                    "ADD_MEMORIZED_SPELL",
                    field("spell", $.value),
                    field("level", $.value),
                    field("type", $.value),
                    optional(seq("(", field("count", $.value), ")")),
                ),
            ),

        patch_remove_memorized_spell: ($) => prec.right(seq("REMOVE_MEMORIZED_SPELL", repeat1($.value))),
        patch_remove_memorized_spells: ($) => "REMOVE_MEMORIZED_SPELLS",
        patch_remove_known_spells: ($) => "REMOVE_KNOWN_SPELLS",
        patch_remove_cre_effects: ($) => "REMOVE_CRE_EFFECTS",

        patch_add_known_spell: ($) =>
            seq("ADD_KNOWN_SPELL", field("spell", $.value), field("level", $.value), field("type", $.value)),

        patch_remove_known_spell: ($) => prec.right(seq("REMOVE_KNOWN_SPELL", repeat1(field("spell", $.value)))),

        patch_add_map_note: ($) =>
            seq(
                "ADD_MAP_NOTE",
                field("x", $.value),
                field("y", $.value),
                field("color", $.value),
                field("strref", $.value),
            ),

        patch_set_bg2_proficiency: ($) =>
            seq("SET_BG2_PROFICIENCY", field("proficiency", $.value), field("value", $.value)),

        // Functions
        patch_launch_function: ($) =>
            seq(
                choice("LAUNCH_PATCH_FUNCTION", "LPF"),
                field("name", choice($.identifier, $.string)),
                repeat($._func_call_param),
                "END",
            ),

        patch_launch_macro: ($) =>
            seq(choice("LAUNCH_PATCH_MACRO", "LPM"), field("name", choice($.identifier, $.string))),

        patch_replace_bcs_block: ($) =>
            prec.right(
                seq(
                    choice("REPLACE_BCS_BLOCK", "R_B_B"),
                    optional($._opt_case),
                    repeat1(field("file", $.string)),
                    optional(seq("ON_MISMATCH", repeat($._patch), "END")),
                ),
            ),

        // Arrays
        patch_define_array: ($) => seq("DEFINE_ARRAY", field("name", $.value), "BEGIN", repeat($.value), "END"),
        patch_define_associative_array: defineAssocArray("DEFINE_ASSOCIATIVE_ARRAY"),
        patch_clear_array: clearArray("CLEAR_ARRAY"),

        patch_sort_array_indices: ($) =>
            seq("SORT_ARRAY_INDICES", field("array", $.value), choice("NUMERICALLY", "LEXICOGRAPHICALLY")),

        assoc_entry: ($) => seq(choice($.value, $.var_name_numeric), repeat(seq(",", $.value)), "=>", $.value),

        // Print/log operations (using helpers)
        patch_print: printOp("PATCH_PRINT"),
        patch_log: printOp("PATCH_LOG"),
        patch_warn: printOp("PATCH_WARN"),
        patch_fail: printOp("PATCH_FAIL"),
        patch_abort: printOp("PATCH_ABORT"),

        patch_include: ($) => prec.right(seq("PATCH_INCLUDE", repeat1(field("file", $.value)))),
        patch_reraise: ($) => "PATCH_RERAISE",
        patch_silent: ($) => "PATCH_SILENT",
        patch_verbose: ($) => "PATCH_VERBOSE",
        patch_compile_baf_to_bcs: ($) => "COMPILE_BAF_TO_BCS",
        patch_decompile_bcs_to_baf: ($) => "DECOMPILE_BCS_TO_BAF",
        patch_compile_d_to_dlg: ($) => "COMPILE_D_TO_DLG",
        patch_decompile_dlg_to_d: ($) => "DECOMPILE_DLG_TO_D",

        patch_decompile_and_patch: ($) => seq("DECOMPILE_AND_PATCH", "BEGIN", repeat($._patch), "END"),

        patch_decompress_replace_file: ($) =>
            seq(
                "DECOMPRESS_REPLACE_FILE",
                field("offset", $.value),
                field("compressed_size", $.value),
                field("uncompressed_size", $.value),
            ),

        patch_compress_replace_file: ($) =>
            seq(
                "COMPRESS_REPLACE_FILE",
                field("offset", $.value),
                field("uncompressed_size", $.value),
                field("level", $.value),
            ),

        patch_decompress_into_var: ($) =>
            seq(
                "DECOMPRESS_INTO_VAR",
                field("offset", $.value),
                field("compressed_size", $.value),
                field("uncompressed_size", $.value),
                field("var", $.identifier),
            ),

        patch_try: tryBlock("PATCH_TRY", ($) => $._patch),

        inner_patch: innerPatchOp("INNER_PATCH"),

        inner_patch_save: ($) =>
            seq(
                "INNER_PATCH_SAVE",
                field("var", $._assignable),
                field("buffer", $.value),
                "BEGIN",
                repeat($._patch),
                "END",
            ),

        inner_patch_file: ($) => seq("INNER_PATCH_FILE", field("file", $.value), "BEGIN", repeat($._patch), "END"),

        inner_action: ($) => seq("INNER_ACTION", "BEGIN", repeat($._action), "END"),

        // =========================================
        // ACTIONS
        // =========================================

        _action: ($) =>
            choice(
                // File operations
                $.action_copy,
                $.action_copy_existing,
                $.action_copy_existing_regexp,
                $.action_copy_large,
                $.action_copy_random,
                $.action_copy_all_gam_files,
                $.action_compile,
                $.action_create,
                $.action_extend_top,
                $.action_extend_bottom,
                $.action_append,
                $.action_append_col,
                $.action_append_outer,
                $.action_delete,
                $.action_move,
                $.action_mkdir,
                // Control flow
                $.action_if,
                $.action_match,
                $.action_try,
                $.outer_for,
                $.outer_while,
                $.action_for_each,
                $.action_php_each,
                // Variables
                $.action_outer_set,
                $.action_outer_sprint,
                $.action_outer_text_sprint,
                $.action_outer_sprintf,
                $.action_with_tra,
                $.action_with_scope,
                $.action_add_journal,
                $.action_outer_patch,
                $.action_outer_patch_save,
                $.action_outer_inner_patch,
                $.action_outer_inner_patch_save,
                // Includes
                $.action_include,
                $.action_reinclude,
                // Functions/macros
                $.action_define_macro,
                $.action_define_patch_macro,
                $.action_define_function,
                $.action_define_patch_function,
                $.action_launch_macro,
                $.action_launch_function,
                // Arrays
                $.action_define_array,
                $.action_define_associative_array,
                $.action_clear_array,
                // String/tra
                $.action_string_set,
                $.action_load_tra,
                // Game data modification
                $.action_add_projectile,
                $.action_add_sectype,
                $.action_add_area_type,
                $.action_add_spell,
                $.action_add_kit,
                $.action_add_music,
                // System/execution
                $.action_at_now,
                $.action_at_interactive_now,
                $.action_at_exit,
                $.action_at_interactive_exit,
                $.action_at_uninstall,
                $.action_at_interactive_uninstall,
                $.action_at_uninstall_exit,
                $.action_at_interactive_uninstall_exit,
                $.action_uninstall,
                $.action_bash_for,
                $.action_decompress_biff,
                $.action_make_biff,
                // Misc
                $.action_print,
                $.action_log,
                $.action_warn,
                $.action_fail,
                $.action_clear_memory,
                $.action_silent,
                $.action_verbose,
                $.action_to_upper,
                $.action_to_lower,
                $.action_get_strref,
                $.action_disable_from_key,
                $.action_get_resource_array,
                $.action_register_uninstall,
                $.action_random_seed,
                $.action_readln,
                $.inlined_file,
            ),

        // File operations
        action_copy: ($) =>
            seq(
                "COPY",
                optional($._opt_no_backup),
                optional($._opt_glob),
                repeat1($.file_pair),
                optional($.patches),
                optional($.when),
            ),

        action_copy_existing: ($) =>
            seq(
                "COPY_EXISTING",
                optional($._opt_no_backup),
                repeat1($.file_pair),
                optional($.patches),
                optional($.when),
            ),

        action_copy_existing_regexp: ($) =>
            seq(
                "COPY_EXISTING_REGEXP",
                optional($._opt_no_backup),
                optional($._opt_glob),
                repeat1($.file_pair),
                optional($.patches),
                optional($.when),
            ),

        action_copy_large: ($) => seq("COPY_LARGE", optional($._opt_no_backup), optional($._opt_glob), $.file_pair),

        action_copy_random: ($) => seq("COPY_RANDOM", repeat1(seq("(", repeat1($.value), ")")), optional($.patches)),

        action_copy_all_gam_files: ($) => seq("COPY_ALL_GAM_FILES", optional($.patches)),

        file_pair: ($) => seq(field("from", $.value), field("to", $.value)),

        // Patches inside actions - either bare patches or BEGIN/END block
        // Named rule (not hidden) so context detection can find it in AST
        patches: ($) => prec.right(choice(repeat1($._patch), $.patch_block)),

        patch_block: ($) => prec(-10, seq("BEGIN", repeat($._patch), "END")),

        // When clause: IF_SIZE_IS, IF regexp, UNLESS regexp, IF_EXISTS, BUT_ONLY, BUT_ONLY_IF_IT_CHANGES
        // All can appear in any order, multiple IF/UNLESS allowed
        when: ($) =>
            prec.right(
                repeat1(
                    choice(
                        seq("IF", field("if_resource", $.value)),
                        seq("UNLESS", field("unless_resource", $.value)),
                        seq("IF_SIZE_IS", field("size", $.value)),
                        "IF_EXISTS",
                        "BUT_ONLY",
                        "BUT_ONLY_IF_IT_CHANGES",
                    ),
                ),
            ),

        action_compile: ($) =>
            prec.right(
                seq(
                    "COMPILE",
                    optional(choice("EVALUATE_BUFFER", "EVAL")),
                    repeat1(field("source", $.value)),
                    optional(choice("EVALUATE_BUFFER", "EVAL")),
                    optional(seq("USING", repeat1(field("tra", $.value)))),
                ),
            ),

        action_extend_top: extendAction("EXTEND_TOP"),
        action_extend_bottom: extendAction("EXTEND_BOTTOM"),

        action_append: appendAction("APPEND"),
        action_append_col: appendAction("APPEND_COL"),

        action_append_outer: ($) =>
            seq("APPEND_OUTER", field("file", $.value), field("text", $.value), optional("KEEP_CRLF")),

        action_delete: ($) => prec.right(seq("DELETE", optional($._opt_no_backup), repeat1(field("file", $.value)))),

        action_move: ($) =>
            prec.right(
                seq(
                    "MOVE",
                    optional($._opt_no_backup),
                    choice(
                        // Glob pattern: (directory pattern) destination
                        seq("(", field("dir", $.value), field("pattern", $.value), ")", field("to", $.value)),
                        // Standard file pairs
                        repeat1($.file_pair),
                    ),
                ),
            ),

        action_mkdir: ($) => prec.right(seq("MKDIR", repeat1(field("dir", $.value)))),

        action_create: ($) =>
            seq(
                "CREATE",
                field("type", $.identifier),
                optional(seq("VERSION", field("version", $.value))),
                field("resref", $.value),
                optional($.patches),
            ),

        // Control flow
        action_if: ($) =>
            seq(
                "ACTION_IF",
                field("condition", $.value),
                optional("THEN"),
                "BEGIN",
                repeat($._action),
                "END",
                optional(
                    seq(
                        "ELSE",
                        choice(
                            seq("BEGIN", repeat($._action), "END"),
                            $.action_if,
                            $._action, // Single action without BEGIN...END
                        ),
                    ),
                ),
            ),

        action_match: ($) =>
            seq(
                "ACTION_MATCH",
                field("value", $.value),
                "WITH",
                repeat($.action_match_case),
                optional(seq("DEFAULT", repeat($._action))),
                "END",
            ),

        action_match_case: ($) =>
            seq(
                repeat1($.value),
                optional("WHEN"),
                optional(field("condition", $.value)),
                "BEGIN",
                repeat($._action),
                "END",
            ),

        action_try: tryBlock("ACTION_TRY", ($) => $._action),

        outer_for: forLoop("OUTER_FOR", ($) => $._action),
        outer_while: whileLoop("OUTER_WHILE", ($) => $._action),

        action_for_each: ($) =>
            prec.right(
                seq(
                    "ACTION_FOR_EACH",
                    field("var", $.value),
                    "IN",
                    repeat1($.value),
                    optional("BEGIN"),
                    repeat($._action),
                    "END",
                ),
            ),

        action_php_each: phpEachLoop("ACTION_PHP_EACH")(($) => $._action),

        // Variables
        action_outer_set: ($) =>
            seq(
                "OUTER_SET",
                optional(choice("EVAL", "EVALUATE_BUFFER", "GLOBAL")),
                choice(
                    seq(field("var", $._assignable), $._assign_op, field("value", $.value)),
                    seq(choice("++", "--"), field("var", $._assignable)),
                ),
            ),

        action_outer_sprint: sprintOpGlobal("OUTER_SPRINT"),
        action_outer_text_sprint: sprintOpGlobal("OUTER_TEXT_SPRINT"),

        action_outer_sprintf: sprintfOp("OUTER_SPRINTF"),

        // Local variables (only valid inside macro bodies)
        local_set: ($) => seq("LOCAL_SET", field("var", $._assignable), $._assign_op, field("value", $.value)),
        local_sprint: sprintOp("LOCAL_SPRINT"),

        action_with_tra: ($) => seq("WITH_TRA", repeat1(field("file", $.value)), "BEGIN", repeat($._action), "END"),

        action_with_scope: ($) => seq("WITH_SCOPE", "BEGIN", repeat($._action), "END"),

        // ADD_JOURNAL [EXISTING] [MANAGED] [TITLE (text)] reference list [USING traFile list]
        action_add_journal: ($) =>
            prec.right(
                seq(
                    "ADD_JOURNAL",
                    optional("EXISTING"),
                    optional("MANAGED"),
                    optional(seq("TITLE", "(", field("title", $.value), ")")),
                    repeat1($.value),
                    optional(seq("USING", repeat1(field("tra", $.value)))),
                ),
            ),

        action_outer_patch: outerPatchAction("OUTER_PATCH"),
        action_outer_patch_save: outerPatchSaveAction("OUTER_PATCH_SAVE"),
        action_outer_inner_patch: outerPatchAction("OUTER_INNER_PATCH"),
        action_outer_inner_patch_save: outerPatchSaveAction("OUTER_INNER_PATCH_SAVE"),

        // Includes
        action_include: ($) => prec.right(seq("INCLUDE", repeat1(field("file", $.value)))),
        action_reinclude: ($) =>
            prec.right(seq(choice("REINCLUDE", "ACTION_REINCLUDE"), repeat1(field("file", $.value)))),

        // Functions/macros definitions (using helpers)
        action_define_macro: defineMacro("DEFINE_ACTION_MACRO", ($) => $._action),
        action_define_patch_macro: defineMacro("DEFINE_PATCH_MACRO", ($) => $._patch),
        action_define_function: defineFunction("DEFINE_ACTION_FUNCTION", ($) => $._action),
        action_define_patch_function: defineFunction("DEFINE_PATCH_FUNCTION", ($) => $._patch),

        _func_decl_param: ($) => choice($.int_var_decl, $.str_var_decl, $.ret_decl, $.ret_array_decl),

        int_var_decl: ($) => seq("INT_VAR", repeat(seq(choice($.identifier, $.string), "=", $.value))),

        str_var_decl: ($) => seq("STR_VAR", repeat(seq(choice($.identifier, $.string), "=", $.value))),

        ret_decl: ($) => seq("RET", repeat1($.identifier)),
        ret_array_decl: ($) => seq("RET_ARRAY", repeat1($.identifier)),

        // Function/macro calls
        action_launch_macro: ($) =>
            seq(choice("LAUNCH_ACTION_MACRO", "LAM"), field("name", choice($.identifier, $.string))),

        action_launch_function: ($) =>
            seq(
                choice("LAUNCH_ACTION_FUNCTION", "LAF"),
                field("name", choice($.identifier, $.string)),
                repeat($._func_call_param),
                "END",
            ),

        _func_call_param: ($) => choice($.int_var_call, $.str_var_call, $.ret_call, $.ret_array_call),

        // In function calls, left-hand side of assignments is always an identifier/string, not an expression
        int_var_call: ($) => seq("INT_VAR", repeat($.int_var_call_item)),
        int_var_call_item: ($) => seq(choice($.identifier, $.string), optional(seq("=", $.value))),
        str_var_call: ($) => seq("STR_VAR", repeat1($.str_var_call_item)),
        str_var_call_item: ($) => seq(choice($.identifier, $.string), optional(seq("=", $.value))),
        ret_call: ($) => seq("RET", repeat1($.ret_call_item)),
        ret_call_item: ($) => seq(choice($.identifier, $.string), optional(seq("=", $.value))),
        ret_array_call: ($) => seq("RET_ARRAY", repeat1($.ret_array_call_item)),
        ret_array_call_item: ($) => seq(choice($.identifier, $.string), optional(seq("=", $.value))),

        // Arrays
        action_define_array: ($) =>
            seq("ACTION_DEFINE_ARRAY", field("name", $.value), "BEGIN", repeat(choice($.value, $.assoc_entry)), "END"),

        action_define_associative_array: defineAssocArray(
            "ACTION_DEFINE_ASSOCIATIVE_ARRAY",
            "DEFINE_ASSOCIATIVE_ARRAY",
        ),

        action_clear_array: clearArray("ACTION_CLEAR_ARRAY"),

        // String/tra operations
        action_string_set: ($) =>
            prec.right(
                seq(
                    choice("STRING_SET", "STRING_SET_EVALUATE"),
                    repeat1(seq(field("strref", $.value), field("value", $.value))),
                ),
            ),

        action_load_tra: ($) => prec.right(seq("LOAD_TRA", repeat1(field("file", $.value)))),

        // Game data modification
        action_add_sectype: ($) => seq("ADD_SECTYPE", field("name", $.value), field("label", $.value)),

        action_add_area_type: ($) => seq("ADD_AREA_TYPE", field("name", $.value)),

        action_add_spell: ($) =>
            prec.right(
                seq(
                    "ADD_SPELL",
                    field("file", $.value),
                    field("level", $.value),
                    field("type", $.value),
                    field("name", $.value),
                    optional($.patches),
                ),
            ),

        action_add_kit: ($) => prec.right(seq("ADD_KIT", repeat1(choice($.value, $.kit_say)))),

        kit_say: ($) => seq("SAY", $.value),

        action_add_projectile: ($) => seq("ADD_PROJECTILE", field("file", $.value)),

        action_add_music: ($) => seq("ADD_MUSIC", field("name", $.value), field("file", $.value)),

        // System/execution - AT_* commands
        // Pattern A: command + optional EXACT
        action_at_exit: ($) => seq("AT_EXIT", field("command", $.value), optional("EXACT")),
        action_at_interactive_exit: ($) => seq("AT_INTERACTIVE_EXIT", field("command", $.value), optional("EXACT")),
        action_at_uninstall: ($) => seq("AT_UNINSTALL", field("command", $.value), optional("EXACT")),
        action_at_interactive_uninstall: ($) =>
            seq("AT_INTERACTIVE_UNINSTALL", field("command", $.value), optional("EXACT")),
        action_at_uninstall_exit: ($) => seq("AT_UNINSTALL_EXIT", field("command", $.value), optional("EXACT")),
        action_at_interactive_uninstall_exit: ($) =>
            seq("AT_INTERACTIVE_UNINSTALL_EXIT", field("command", $.value), optional("EXACT")),

        action_uninstall: ($) => seq("UNINSTALL", field("tp2", $.value), field("component", $.value)),

        // Pattern B: optional variable + command + optional EXACT
        action_at_now: ($) =>
            seq("AT_NOW", optional(field("var", $.identifier)), field("command", $.value), optional("EXACT")),
        action_at_interactive_now: ($) =>
            seq(
                "AT_INTERACTIVE_NOW",
                optional(field("var", $.identifier)),
                field("command", $.value),
                optional("EXACT"),
            ),

        action_bash_for: ($) =>
            seq(
                "ACTION_BASH_FOR",
                field("directory", $.value),
                field("pattern", $.value),
                "BEGIN",
                repeat($._action),
                "END",
            ),

        action_decompress_biff: ($) => seq("DECOMPRESS_BIFF", field("file", $.value)),

        action_make_biff: ($) =>
            seq("MAKE_BIFF", field("name", $.value), "BEGIN", repeat1($.directory_file_regexp), "END"),

        // Shared by MAKE_BIFF, ACTION_BASH_FOR, PATCH_BASH_FOR
        directory_file_regexp: ($) =>
            seq(
                field("directory", $.value),
                optional(choice("EVALUATE_REGEXP", "EXACT_MATCH")),
                field("pattern", $.value),
            ),

        // Print/messaging (using helpers)
        action_print: printOp("PRINT"),
        action_log: printOp("LOG"),
        action_warn: printOp("WARN"),
        action_fail: printOp("FAIL"),

        action_clear_memory: ($) =>
            choice("CLEAR_MEMORY", "CLEAR_ARRAYS", "CLEAR_CODES", "CLEAR_INLINED", "CLEAR_EVERYTHING", "CLEAR_IDS_MAP"),

        action_random_seed: ($) => seq("RANDOM_SEED", $.value),

        action_readln: ($) => seq("ACTION_READLN", $.value),

        action_silent: ($) => "SILENT",
        action_verbose: ($) => "VERBOSE",

        // Case conversion (using helpers)
        action_to_upper: caseConvert("ACTION_TO_UPPER"),
        action_to_lower: caseConvert("ACTION_TO_LOWER"),

        action_get_strref: ($) => seq("ACTION_GET_STRREF", field("strref", $.value), field("var", $.identifier)),

        action_disable_from_key: ($) => prec.right(seq("DISABLE_FROM_KEY", repeat1(field("resource", $.value)))),

        action_get_resource_array: ($) => seq("GET_RESOURCE_ARRAY", field("name", $.value), field("regexp", $.value)),

        action_register_uninstall: ($) => seq("REGISTER_UNINSTALL", field("file", $.value)),

        // =========================================
        // TOP-LEVEL DIRECTIVES
        // =========================================

        _top_level: ($) =>
            choice(
                // Prologue directives (BACKUP/AUTHOR/SUPPORT) are in source_file, not here
                $.version_flag,
                $.readme_directive,
                $.no_if_eval_bug_flag,
                $.auto_eval_strings_flag,
                $.allow_missing_directive,
                $.auto_tra_directive,
                $.language_directive,
                $.component,
                $.inlined_file,
                $.always_block,
            ),

        backup_directive: ($) => seq("BACKUP", field("path", $.value)),
        author_directive: ($) => seq("AUTHOR", field("email", $.value)),
        support_directive: ($) => seq("SUPPORT", field("url", $.value)),
        version_flag: ($) => seq("VERSION", field("version", $.value)),
        readme_directive: ($) => prec.right(seq("README", repeat1(field("path", $.value)))),
        no_if_eval_bug_flag: ($) => "NO_IF_EVAL_BUG",
        auto_eval_strings_flag: ($) => "AUTO_EVAL_STRINGS",
        allow_missing_directive: ($) => prec.right(seq("ALLOW_MISSING", repeat1(field("file", $.value)))),
        auto_tra_directive: ($) => seq("AUTO_TRA", field("path", $.value)),

        language_directive: ($) =>
            prec.right(
                seq(
                    "LANGUAGE",
                    field("name", $.value),
                    field("directory", $.value),
                    repeat1(field("tra_file", $.value)),
                ),
            ),

        component: ($) =>
            seq(alias("BEGIN", $.component_begin), field("name", $.value), repeat($._componentFlag), repeat($._action)),

        _componentFlag: ($) =>
            choice(
                $.designated_flag,
                $.deprecated_flag,
                $.subcomponent_flag,
                $.group_flag,
                $.require_predicate_flag,
                $.require_component_flag,
                $.forbid_component_flag,
                $.label_flag,
            ),

        designated_flag: ($) => seq("DESIGNATED", field("number", $.number)),
        deprecated_flag: ($) => seq("DEPRECATED", field("message", $.value)),
        subcomponent_flag: ($) => seq("SUBCOMPONENT", field("name", $.value)),
        group_flag: ($) => seq("GROUP", field("name", $.value)),
        label_flag: ($) => seq("LABEL", field("label", $.value)),
        require_predicate_flag: ($) => seq("REQUIRE_PREDICATE", field("predicate", $.value), field("message", $.value)),
        require_component_flag: ($) =>
            seq("REQUIRE_COMPONENT", field("file", $.value), field("component", $.value), field("message", $.value)),
        forbid_component_flag: ($) =>
            seq("FORBID_COMPONENT", field("file", $.value), field("component", $.value), field("message", $.value)),

        always_block: ($) => seq("ALWAYS", repeat($._action), "END"),

        inlined_file: ($) => seq(field("filename", $.inlined_filename), field("body", $.inlined_body), ">>>>>>>>"),
        // Start marker + optional space + filename on same line
        inlined_filename: ($) => /<<<<<<<<[ \t]*[^\n]*/,
        // Body: any content until >>>>>>>>. Allows up to 7 consecutive > chars
        inlined_body: ($) => /([^>]|>[^>]|>>[^>]|>>>[^>]|>>>>[^>]|>>>>>[^>]|>>>>>>[^>]|>>>>>>>[^>])*/,
    },
});
