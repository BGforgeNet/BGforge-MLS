/**
 * Tree-sitter grammar for WeiDU TP2 files.
 * Covers .tp2 (full), .tpa/.tph (actions), .tpp (patches).
 *
 * @file WeiDU TP2 grammar
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

/**
 * The words WeiDU reserves in TP2 code: its lexer returns each one as a keyword, never as a bare name, so none can be
 * a variable, file or array name in any position. Taken from WeiDU 251, the version scripts/ensure-weidu.sh pins;
 * on a WeiDU upgrade, re-derive the list from that release. WeiDU also reserves its spelled-out operators (PLUS for
 * +, LPAREN for `(`); tree-sitter reserves only words the grammar uses as tokens, and the grammar models only the
 * symbols, so those stay out. server/test/integration/weidu-tp2-grammar-differential.test.ts checks both sets.
 */
const RESERVED_WORDS = [
    "ABORT",
    "ABS",
    "ACTION_BASH_FOR",
    "ACTION_CLEAR_ARRAY",
    "ACTION_DEFINE_ARRAY",
    "ACTION_DEFINE_ASSOCIATIVE_ARRAY",
    "ACTION_FOR_EACH",
    "ACTION_GET_STRREF",
    "ACTION_GET_STRREF_F",
    "ACTION_GET_STRREF_FS",
    "ACTION_GET_STRREF_S",
    "ACTION_IF",
    "ACTION_INCLUDE",
    "ACTION_MATCH",
    "ACTION_PHP_EACH",
    "ACTION_READLN",
    "ACTION_REINCLUDE",
    "ACTION_RERAISE",
    "ACTION_SORT_ARRAY_INDICES",
    "ACTION_TIME",
    "ACTION_TO_LOWER",
    "ACTION_TO_UPPER",
    "ACTION_TRY",
    "ADD_AREA_TYPE",
    "ADD_CRE_ITEM",
    "ADD_GAME_NPC",
    "ADD_GAM_NPC",
    "ADD_IF_MISSING",
    "ADD_JOURNAL",
    "ADD_KIT",
    "ADD_KNOWN_SPELL",
    "ADD_MAP_NOTE",
    "ADD_MEMORIZED_SPELL",
    "ADD_MUSIC",
    "ADD_PROJECTILE",
    "ADD_SCHOOL",
    "ADD_SECTYPE",
    "ADD_SPELL",
    "ADD_STORE_ITEM",
    "AFTER",
    "ALLOW_MISSING",
    "ALTER_TLK",
    "ALTER_TLK_LIST",
    "ALTER_TLK_RANGE",
    "ALWAYS",
    "ALWAYS_ASK",
    "AND",
    "ANY",
    "APPEND",
    "APPEND_COL",
    "APPEND_COL_OUTER",
    "APPEND_FILE",
    "APPEND_FILE_EVALUATE",
    "APPEND_OUTER",
    "APPLY_BCS_PATCH",
    "APPLY_BCS_PATCH_OR_COPY",
    "ARE_V10_ACTORS",
    "ARE_V10_AMBIENTS",
    "ARE_V10_ANIMATIONS",
    "ARE_V10_CONTAINERS",
    "ARE_V10_CONTAINER_VERTICES",
    "ARE_V10_DOORS",
    "ARE_V10_DOOR_CLOSED_CELL_VERTICES",
    "ARE_V10_DOOR_CLOSED_OUTLINE_VERTICES",
    "ARE_V10_DOOR_OPEN_CELL_VERTICES",
    "ARE_V10_DOOR_OPEN_OUTLINE_VERTICES",
    "ARE_V10_ENTRANCES",
    "ARE_V10_ITEMS",
    "ARE_V10_REGIONS",
    "ARE_V10_REGION_VERTICES",
    "ARE_V10_SPAWN_POINTS",
    "ARE_V91_ACTORS",
    "AS",
    "ASK_EVERY_COMPONENT",
    "AT",
    "AT_EXIT",
    "AT_INTERACTIVE_EXIT",
    "AT_INTERACTIVE_NOW",
    "AT_INTERACTIVE_UNINSTALL",
    "AT_INTERACTIVE_UNINSTALL_EXIT",
    "AT_NOW",
    "AT_UNINSTALL",
    "AT_UNINSTALL_EXIT",
    "AUTHOR",
    "AUTO_EVAL_STRINGS",
    "AUTO_TRA",
    "A_B_P",
    "BACKUP",
    "BAND",
    "BASR",
    "BEFORE",
    "BEGIN",
    "BIFF",
    "BIFF_IS_COMPRESSED",
    "BLSL",
    "BLSR",
    "BNOT",
    "BOR",
    "BUFFER_LENGTH",
    "BUT_ONLY",
    "BUT_ONLY_IF_IT_CHANGES",
    "BXOR",
    "BYTE_AT",
    "CACHE",
    "CASE_INSENSITIVE",
    "CASE_SENSITIVE",
    "CLEAR",
    "CLEAR_ARRAY",
    "CLEAR_ARRAYS",
    "CLEAR_CODES",
    "CLEAR_EVERYTHING",
    "CLEAR_IDS_MAP",
    "CLEAR_INLINED",
    "CLEAR_MEMORY",
    "COMPILE",
    "COMPILE_BAF_TO_BCS",
    "COMPILE_D_TO_DLG",
    "COMPRESS_INTO_FILE",
    "COMPRESS_INTO_VAR",
    "COMPRESS_REPLACE_FILE",
    "COPY",
    "COPY_ALL_GAM_FILES",
    "COPY_EXISTING",
    "COPY_EXISTING_REGEXP",
    "COPY_KIT",
    "COPY_LARGE",
    "COPY_RANDOM",
    "COUNT_2DA_COLS",
    "COUNT_2DA_ROWS",
    "COUNT_REGEXP_INSTANCES",
    "CREATE",
    "CRE_V10_EFFECTS",
    "CRE_V10_ITEMS",
    "CRE_V10_KNOWN_SPELLS",
    "CRE_V10_SPELL_MEM",
    "CRE_V10_SPELL_MEM_INFO",
    "DECOMPILE_AND_PATCH",
    "DECOMPILE_BCS_TO_BAF",
    "DECOMPILE_DLG_TO_D",
    "DECOMPRESS_BIFF",
    "DECOMPRESS_INTO_FILE",
    "DECOMPRESS_INTO_VAR",
    "DECOMPRESS_REPLACE_FILE",
    "DEFAULT",
    "DEFINED_AS_FUNCTION",
    "DEFINED_AS_INLINED",
    "DEFINE_ACTION_FUNCTION",
    "DEFINE_ACTION_MACRO",
    "DEFINE_ARRAY",
    "DEFINE_ASSOCIATIVE_ARRAY",
    "DEFINE_DIMORPHIC_FUNCTION",
    "DEFINE_FUNCTION_ACTION",
    "DEFINE_FUNCTION_PATCH",
    "DEFINE_MACRO_ACTION",
    "DEFINE_MACRO_PATCH",
    "DEFINE_PATCH_FUNCTION",
    "DEFINE_PATCH_MACRO",
    "DELETE",
    "DELETE_BYTES",
    "DEPRECATED",
    "DESIGNATED",
    "DIRECTORY_EXISTS",
    "DISABLE_FROM_KEY",
    "EDIT_SAV_FILE",
    "ELSE",
    "END",
    "ENGINE_IS",
    "EQUALS",
    "EQUIP",
    "EVAL",
    "EVALUATE_BUFFER",
    "EVALUATE_BUFFER_SPECIAL",
    "EVALUATE_REGEXP",
    "EXACT",
    "EXACT_MATCH",
    "EXISTING",
    "EXTEND_BOTTOM",
    "EXTEND_BOTTOM_REGEXP",
    "EXTEND_MOS",
    "EXTEND_TOP",
    "EXTEND_TOP_REGEXP",
    "FAIL",
    "FILE_CONTAINS",
    "FILE_CONTAINS_EVALUATED",
    "FILE_EXISTS",
    "FILE_EXISTS_IN_GAME",
    "FILE_IS_IN_COMPRESSED_BIF",
    "FILE_IS_IN_COMPRESSED_BIFF",
    "FILE_MD5",
    "FILE_SIZE",
    "FIRST",
    "FOR",
    "FORBID_COMPONENT",
    "FORBID_FILE",
    "FORCED_SUBCOMPONENT",
    "FROM",
    "GAME_INCLUDES",
    "GAME_IS",
    "GET_DIRECTORY_ARRAY",
    "GET_FILE_ARRAY",
    "GET_OFFSET_ARRAY",
    "GET_OFFSET_ARRAY2",
    "GET_RESOURCE_ARRAY",
    "GET_STRREF",
    "GET_STRREF_F",
    "GET_STRREF_FS",
    "GET_STRREF_S",
    "GLOB",
    "GLOBAL",
    "GROUP",
    "IDS_OF_SYMBOL",
    "ID_OF_LABEL",
    "IF",
    "IF_EVAL",
    "IF_EXISTING",
    "IF_EXISTS",
    "IF_SIZE_IS",
    "IN",
    "INCLUDE",
    "INDEX",
    "INDEX_BUFFER",
    "INNER_ACTION",
    "INNER_PATCH",
    "INNER_PATCH_FILE",
    "INNER_PATCH_SAVE",
    "INSERT_2DA_ROW",
    "INSERT_BYTES",
    "INSERT_FILE",
    "INSTALL_BY_DEFAULT",
    "INSTALL_ORDER",
    "INT_VAR",
    "IS_AN_INT",
    "IS_SILENT",
    "ITM_V10_GEN_EFFECTS",
    "ITM_V10_HEADERS",
    "ITM_V10_HEAD_EFFECTS",
    "I_S_I",
    "KEEP_CRLF",
    "LABEL",
    "LAF",
    "LAM",
    "LANGUAGE",
    "LAST",
    "LAUNCH_ACTION_FUNCTION",
    "LAUNCH_ACTION_MACRO",
    "LAUNCH_FUNCTION_ACTION",
    "LAUNCH_FUNCTION_PATCH",
    "LAUNCH_MACRO_ACTION",
    "LAUNCH_MACRO_PATCH",
    "LAUNCH_PATCH_FUNCTION",
    "LAUNCH_PATCH_MACRO",
    "LEXICOGRAPHICALLY",
    "LOAD",
    "LOAD_TRA",
    "LOCAL_SET",
    "LOCAL_SPRINT",
    "LOCAL_TEXT_SPRINT",
    "LOG",
    "LONG_AT",
    "LOOKUP_IDS_SYMBOL_OF_INT",
    "LPF",
    "LPM",
    "MAKE_BIFF",
    "MANAGED",
    "MENU_STYLE",
    "METADATA",
    "MKDIR",
    "MODDER",
    "MODULO",
    "MOD_IS_INSTALLED",
    "MOVE",
    "NEXT_STRREF",
    "NOGLOB",
    "NOMOVE",
    "NOT",
    "NO_IF_EVAL_BUG",
    "NO_LOG_RECORD",
    "NULL",
    "NUMERICALLY",
    "ON_DISABLE",
    "ON_MISMATCH",
    "OR",
    "OUTER_FOR",
    "OUTER_INNER_PATCH",
    "OUTER_INNER_PATCH_SAVE",
    "OUTER_PATCH",
    "OUTER_PATCH_SAVE",
    "OUTER_SET",
    "OUTER_SNPRINT",
    "OUTER_SPRINT",
    "OUTER_SPRINTF",
    "OUTER_TEXT_SPRINT",
    "OUTER_WHILE",
    "PATCH_ABORT",
    "PATCH_BASH_FOR",
    "PATCH_CLEAR_ARRAY",
    "PATCH_DEFINE_ARRAY",
    "PATCH_DEFINE_ASSOCIATIVE_ARRAY",
    "PATCH_FAIL",
    "PATCH_FOR_EACH",
    "PATCH_GAM",
    "PATCH_IF",
    "PATCH_INCLUDE",
    "PATCH_LOG",
    "PATCH_MATCH",
    "PATCH_PHP_EACH",
    "PATCH_PRINT",
    "PATCH_RANDOM_SEED",
    "PATCH_READLN",
    "PATCH_REINCLUDE",
    "PATCH_RERAISE",
    "PATCH_SILENT",
    "PATCH_TIME",
    "PATCH_TRY",
    "PATCH_VERBOSE",
    "PATCH_WARN",
    "PATCH_WITH_SCOPE",
    "PATCH_WITH_TRA",
    "PHP_EACH",
    "PRETTY_PRINT_2DA",
    "PRINT",
    "QUICK_MENU",
    "QUOTE",
    "RANDOM",
    "RANDOM_SEED",
    "README",
    "READ_2DA_ENTRIES_NOW",
    "READ_2DA_ENTRY",
    "READ_2DA_ENTRY_FORMER",
    "READ_ASCII",
    "READ_BYTE",
    "READ_LONG",
    "READ_SBYTE",
    "READ_SHORT",
    "READ_SLONG",
    "READ_SSHORT",
    "READ_STRREF",
    "READ_STRREF_F",
    "READ_STRREF_FS",
    "READ_STRREF_S",
    "REBUILD_CRE_FILE",
    "REFACTOR_BAF_TRIGGER",
    "REFACTOR_D_TRIGGER",
    "REFACTOR_TRIGGER",
    "REGISTER_UNINSTALL",
    "REINCLUDE",
    "REM",
    "REMOVE_2DA_ROW",
    "REMOVE_CRE_EFFECTS",
    "REMOVE_CRE_ITEM",
    "REMOVE_CRE_ITEMS",
    "REMOVE_KNOWN_SPELL",
    "REMOVE_KNOWN_SPELLS",
    "REMOVE_MEMORIZED_SPELL",
    "REMOVE_MEMORIZED_SPELLS",
    "REMOVE_STORE_ITEM",
    "REPLACE",
    "REPLACE_BCS_BLOCK",
    "REPLACE_BCS_BLOCK_REGEXP",
    "REPLACE_CRE_ITEM",
    "REPLACE_EVALUATE",
    "REPLACE_TEXTUALLY",
    "REQUIRE_COMPONENT",
    "REQUIRE_FILE",
    "REQUIRE_PREDICATE",
    "RESOLVE_STR_REF",
    "RESOURCE_CONTAINS",
    "RET",
    "RET_ARRAY",
    "RINDEX",
    "RINDEX_BUFFER",
    "R_B_B",
    "R_B_B_RE",
    "SAY",
    "SAY_EVALUATED",
    "SBYTE_AT",
    "SCRIPT_STYLE",
    "SET",
    "SET_2DA_ENTRIES_NOW",
    "SET_2DA_ENTRY",
    "SET_2DA_ENTRY_LATER",
    "SET_BG2_PROFICIENCY",
    "SET_IDS_SYMBOL_OF_INT",
    "SHORT_AT",
    "SILENT",
    "SIZE_OF_FILE",
    "SLONG_AT",
    "SNPRINT",
    "SORT_ARRAY_INDICES",
    "SOURCE_BIFF",
    "SPACES",
    "SPL_V10_GEN_EFFECTS",
    "SPL_V10_HEADERS",
    "SPL_V10_HEAD_EFFECTS",
    "SPRINT",
    "SPRINTF",
    "SSHORT_AT",
    "STATE_WHICH_SAYS",
    "STO_V10_CURES",
    "STO_V10_DRINKS",
    "STO_V10_ITEMS_PURCHASED",
    "STO_V10_ITEMS_SOLD",
    "STRING_COMPARE",
    "STRING_COMPARE_CASE",
    "STRING_COMPARE_REGEXP",
    "STRING_CONTAINS_REGEXP",
    "STRING_EQUAL",
    "STRING_EQUAL_CASE",
    "STRING_LENGTH",
    "STRING_MATCHES_REGEXP",
    "STRING_SET",
    "STRING_SET_EVALUATE",
    "STRING_SET_RANGE",
    "STR_CMP",
    "STR_EQ",
    "STR_VAR",
    "SUBCOMPONENT",
    "SUB_COMPONENT",
    "SUPPORT",
    "TEXT",
    "TEXT_SPRINT",
    "THEN",
    "TITLE",
    "TO_LOWER",
    "TO_UPPER",
    "TRA_ENTRY_EXISTS",
    "TWOHANDED",
    "UNINSTALL",
    "UNINSTALL_ORDER",
    "UNLESS",
    "USING",
    "VALID_SCRIPT_ACTIONS",
    "VALID_SCRIPT_TRIGGERS",
    "VARIABLE_IS_IN_ARRAY",
    "VARIABLE_IS_SET",
    "VERBOSE",
    "VERSION",
    "WARN",
    "WHEN",
    "WHILE",
    "WITH",
    "WITH_SCOPE",
    "WITH_TRA",
    "WMP_AREAS",
    "WMP_EAST_LINKS",
    "WMP_LINKS",
    "WMP_NORTH_LINKS",
    "WMP_SOUTH_LINKS",
    "WMP_WEST_LINKS",
    "WRITE_ASCII",
    "WRITE_ASCIIE",
    "WRITE_ASCIIL",
    "WRITE_ASCIIT",
    "WRITE_ASCII_LIST",
    "WRITE_ASCII_TERMINATE",
    "WRITE_ASCII_TERMINATED",
    "WRITE_BYTE",
    "WRITE_EVALUATED_ASCII",
    "WRITE_FILE",
    "WRITE_LONG",
    "WRITE_SHORT",
];

// =========================================
// HELPER FUNCTIONS
// =========================================

/** `rule` exactly `n` times. */
const repeatN = (rule, n) => seq(...Array.from({ length: n }, () => rule));

/** GET_OFFSET_ARRAY presets: each stands for the seven values of one file structure's array. */
const OFFSET_ARRAY_PRESETS = [
    "ARE_V10_ACTORS",
    "ARE_V10_REGIONS",
    "ARE_V10_SPAWN_POINTS",
    "ARE_V10_ENTRANCES",
    "ARE_V10_CONTAINERS",
    "ARE_V10_AMBIENTS",
    "ARE_V10_DOORS",
    "ARE_V10_ANIMATIONS",
    "ARE_V91_ACTORS",
    "CRE_V10_KNOWN_SPELLS",
    "CRE_V10_SPELL_MEM_INFO",
    "CRE_V10_EFFECTS",
    "CRE_V10_ITEMS",
    "ITM_V10_HEADERS",
    "ITM_V10_GEN_EFFECTS",
    "SPL_V10_HEADERS",
    "SPL_V10_GEN_EFFECTS",
    "STO_V10_ITEMS_PURCHASED",
    "STO_V10_ITEMS_SOLD",
    "STO_V10_DRINKS",
    "STO_V10_CURES",
    "WMP_AREAS",
    "WMP_LINKS",
];

/** GET_OFFSET_ARRAY2 presets: each follows the parent offset and stands for the other seven values. */
const OFFSET_ARRAY2_PRESETS = [
    "ARE_V10_ITEMS",
    "ARE_V10_REGION_VERTICES",
    "ARE_V10_CONTAINER_VERTICES",
    "ARE_V10_DOOR_OPEN_OUTLINE_VERTICES",
    "ARE_V10_DOOR_CLOSED_OUTLINE_VERTICES",
    "ARE_V10_DOOR_OPEN_CELL_VERTICES",
    "ARE_V10_DOOR_CLOSED_CELL_VERTICES",
    "CRE_V10_SPELL_MEM",
    "ITM_V10_HEAD_EFFECTS",
    "SPL_V10_HEAD_EFFECTS",
    "WMP_NORTH_LINKS",
    "WMP_WEST_LINKS",
    "WMP_SOUTH_LINKS",
    "WMP_EAST_LINKS",
];

/** choice() that handles single keyword without warning */
const kw = (...keywords) => (keywords.length === 1 ? keywords[0] : choice(...keywords));

/** Read patch: KEYWORD offset var [ELSE value] */
const readPatch =
    (...keywords) =>
    ($) =>
        seq(
            kw(...keywords),
            field("offset", $.value),
            $._var_target,
            optional(seq("ELSE", field("else_value", $.value))),
        );

/** Write patch: KEYWORD offset value */
const writePatch =
    (...keywords) =>
    ($) =>
        seq(kw(...keywords), field("offset", $.value), field("value", $.value));

/** Memory access expression: KEYWORD offset. The offset binds tighter than any operator: `BYTE_AT 0 + 1` adds 1. */
const memoryAt =
    (...keywords) =>
    ($) =>
        seq(kw(...keywords), field("offset", alias($._tight_expr, $.value)));

/** A one-string operand, still a `value` node to consumers (completion keys on it). */
const operand = ($) => alias($._operand, $.value);

/** Check expression: KEYWORD operand */
const checkExpr =
    (keyword, fieldName = "value") =>
    ($) =>
        seq(keyword, field(fieldName, operand($)));

/** Sprint-like operation with optional GLOBAL: KEYWORD [GLOBAL] var text */
const sprintOpGlobal =
    (...keywords) =>
    ($) =>
        prec.right(seq(kw(...keywords), optional("GLOBAL"), $._var_target, field("value", $.value), ...textTail($)));

/** TEXT_SPRINT-like operation: as sprintOpGlobal, but the value is a plain string with no sound or female text. */
const textSprintOpGlobal =
    (...keywords) =>
    ($) =>
        seq(kw(...keywords), optional("GLOBAL"), $._var_target, field("value", $.value));

/** Sprintf-like operation: KEYWORD var format [(args...)] */
const sprintfOp = (keyword) => ($) =>
    prec.right(
        seq(
            keyword,
            field("var", $.value),
            field("format", $.value),
            // Sound only: a female text here would be ambiguous with the parenthesised argument list.
            optional($.sound_ref),
            optional(seq("(", repeat($.value), ")")),
        ),
    );

/**
 * The tail of a WeiDU text argument: an optional sound, then an optional female text with its own sound
 * (`~male~ [M] ~female~ [F]`). The female text is a string, as in WeiDU, so a following `name = value` statement
 * is never read as one.
 */
const textTail = ($) => [optional($.sound_ref), optional(seq(field("female", $.string), optional($.sound_ref)))];

/**
 * A name as WeiDU takes it in a variable position: a bare or quoted name, an array element, or an evaluated name,
 * with the EVAL / EVALUATE_BUFFER prefix kept outside the named field.
 */
const nameIn = ($, fieldName) =>
    seq(
        optional(choice("EVAL", "EVALUATE_BUFFER")),
        field(fieldName, choice($.identifier, $.var_name_numeric, $.array_access, $.string)),
    );

/** Print-like operation: KEYWORD message */
const printOp = (keyword) => ($) => prec.right(seq(keyword, field("message", $.value), ...textTail($)));

/** Case conversion: KEYWORD var (identifier only) */
const caseConvert = (keyword) => ($) => seq(keyword, $._var_target);

/** CRE/store item patch: KEYWORD items..., each one string */
const itemPatch = (keyword) => ($) => seq(keyword, repeat(operand($)));

/** EXTEND action: KEYWORD existing new_file [EVAL] patches... [USING tra...] [when] */
const extendAction =
    (...keywords) =>
    ($) =>
        prec.right(
            seq(
                kw(...keywords),
                field("existing", $.value),
                field("new_file", $.value),
                optional(choice("EVALUATE_BUFFER", "EVAL")),
                optional($._patch_list),
                optional(seq("USING", repeat(field("tra", $.value)))),
                optional($.when),
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

/** APPEND_COL action: KEYWORD [+/-] file text [column] [when] */
const appendColAction = (keyword) => ($) =>
    prec.right(
        seq(
            keyword,
            optional($._opt_no_backup),
            field("file", $.value),
            field("text", $.value),
            optional(field("column", $.value)),
            optional($.when),
        ),
    );

/** A block's statements, as the shared list rule for the statement kind `bodyType` returns (see _action_list). */
const blockBody = ($, bodyType) => {
    const item = bodyType($);
    if (item.name === "_action") return optional($._action_list);
    if (item.name === "_patch") return optional($._patch_list);
    throw new Error(`blockBody: no list rule for ${item.name}`);
};

/** Define macro: KEYWORD name BEGIN body END (body can include LOCAL_SET/LOCAL_SPRINT) */
const defineMacro = (keyword, bodyType) => ($) =>
    seq(
        keyword,
        field("name", choice($.identifier, $.var_name_numeric, $.string)),
        "BEGIN",
        repeat(choice(bodyType($), $.local_set, $.local_sprint)),
        "END",
    );

/** Define function: KEYWORD name params BEGIN body END */
const defineFunction = (keyword, bodyType) => ($) =>
    seq(
        keyword,
        field("name", choice($.identifier, $.var_name_numeric, $.string)),
        repeat($._func_decl_param),
        "BEGIN",
        blockBody($, bodyType),
        "END",
    );

/** FOR loop: FOR (init; cond; step) BEGIN body END */
const forLoop = (keyword, bodyType) => ($) =>
    seq(
        keyword,
        "(",
        optional($._patch_list),
        ";",
        field("condition", $.value),
        ";",
        optional($._patch_list),
        ")",
        "BEGIN",
        blockBody($, bodyType),
        "END",
    );

/** WHILE loop: WHILE cond BEGIN body END */
const whileLoop = (keyword, bodyType) => ($) =>
    seq(keyword, field("condition", $.value), "BEGIN", blockBody($, bodyType), "END");

/** PHP_EACH loop: KEYWORD array AS key => value BEGIN body END */
const phpEachLoop =
    (...keywords) =>
    (bodyType) =>
    ($) =>
        seq(
            kw(...keywords),
            field("array", $.value),
            "AS",
            // WeiDU takes a string for either loop variable, not just a bare name - ~~ is idiomatic for
            // "discard this half of the pair". Kept as identifier|string rather than $.value so the
            // identifier case stays a direct child: the rename/definition providers key on that shape,
            // and a quoted variable declares no renamable name.
            nameIn($, "key_var"),
            "=>",
            nameIn($, "value_var"),
            "BEGIN",
            blockBody($, bodyType),
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
const outerPatchAction = (keyword) => ($) =>
    seq(keyword, field("buffer", $.value), "BEGIN", optional($._patch_list), "END");

/** OUTER_PATCH_SAVE action: KEYWORD var buffer BEGIN patches END */
const outerPatchSaveAction = (keyword) => ($) =>
    seq(keyword, $._var_target, field("buffer", $.value), "BEGIN", optional($._patch_list), "END");

/** INNER_PATCH: KEYWORD buffer BEGIN patches END */
const innerPatchOp = (keyword) => ($) =>
    seq(keyword, field("buffer", $.value), "BEGIN", optional($._patch_list), "END");

/** The tail MATCH and TRY share: WITH case... DEFAULT body END. DEFAULT is required. */
const withCases = (caseRule, bodyRule) => seq("WITH", repeat(caseRule), "DEFAULT", repeat(bodyRule), "END");

/** A MATCH or TRY case: values... [WHEN guard] BEGIN body END, or ANY guard BEGIN body END. */
const matchCase = (bodyType) => ($) =>
    seq(
        choice(
            seq(repeat1($.value), optional(seq("WHEN", field("guard", $.value)))),
            seq("ANY", field("guard", $.value)),
        ),
        "BEGIN",
        blockBody($, bodyType),
        "END",
    );

/** TRY block: KEYWORD body WITH case... DEFAULT handler END */
const tryBlock = (keyword, bodyType, caseRule) => ($) =>
    seq(keyword, blockBody($, bodyType), withCases(caseRule($), bodyType($)));

/** DEFINE_ASSOCIATIVE_ARRAY: KEYWORD name BEGIN entries END */
const defineAssocArray =
    (...keywords) =>
    ($) =>
        seq(kw(...keywords), field("name", $.value), "BEGIN", repeat($.assoc_entry), "END");

/** CLEAR_ARRAY: KEYWORD array */
const clearArray = (keyword) => ($) => seq(keyword, field("array", $.value));

/**
 * WeiDU's binary operator levels, loosest first (the conditional is looser still). Prefix operators and memory reads
 * bind tighter than all of them; that is structural here, through _tight_expr, rather than a precedence number.
 */
const BINARY_LEVELS = [
    ["OR", "||"],
    ["AND", "&&"],
    ["BOR", "|"],
    ["BXOR", "^^"],
    ["BAND", "&"],
    [
        "=",
        "==",
        "!=",
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
    ],
    ["<", ">", "<=", ">="],
    ["BLSL", "BLSR", "BASR", "<<", ">>"],
    // `^` joins strings in WeiDU and is no arithmetic operator there; it is kept, leniently, beside `+`.
    ["+", "-", "^"],
    ["*", "/", "MODULO", "REM"],
    ["**"],
];

/** The conditional's level, below every binary one; binary level i takes PREC_TERNARY + 1 + i. */
const PREC_TERNARY = 1;

/** Every expression form that binds tighter than any operator: the operand of a prefix operator or memory read. */
const tightExprs = ($) => [
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
    $.biff_is_compressed_expr,
    $.file_size_expr,
    $.size_of_file_expr,
    $.file_md5_expr,
    $.variable_is_set_expr,
    $.is_an_int_expr,
    $.game_is_expr,
    $.game_includes_expr,
    $.engine_is_expr,
    $.mod_is_installed_expr,
    $.install_order_expr,
    $.id_of_label_expr,
    $.file_contains_expr,
    $.resource_contains_expr,
    $.file_contains_evaluated_expr,
    $.string_length_expr,
    $.variable_is_in_array_expr,
    $.defined_as_function_expr,
    $.defined_as_inlined_expr,
    $.valid_script_actions_expr,
    $.valid_script_triggers_expr,
    // Nullary expressions
    $.nullary_expr,
    $.array_access,
    $._primary,
];

/** Sort array indices: KEYWORD array [NUMERICALLY | LEXICOGRAPHICALLY]; WeiDU defaults to LEXICOGRAPHICALLY. */
const sortArrayIndices = (keyword) => ($) =>
    prec.right(seq(keyword, field("array", $.value), optional(choice("NUMERICALLY", "LEXICOGRAPHICALLY"))));

/** File array: KEYWORD name directory regexp */
const fileArray = (keyword) => ($) =>
    seq(keyword, field("name", $.value), field("directory", $.value), field("regexp", $.value));

/** GET_STRREF: KEYWORD strref var */
const getStrref =
    (...keywords) =>
    ($) =>
        seq(kw(...keywords), field("strref", $.value), $._var_target);

export default grammar({
    name: "weidu_tp2",

    // Block comments nest, which no internal token can express. String contents are scanned there too: the
    // scanner is asked for a comment wherever one may appear, which includes right after a string's opening
    // delimiter, so only it can tell that `~/* b */~` is text. See src/scanner.c.
    externals: ($) => [
        $._comment_closed,
        $._comment_open,
        $.tilde_content,
        $.double_content,
        $.five_tilde_content,
        $.percent_content,
        $._percent_close,
    ],

    extras: ($) => [/\s/, $.comment, $.line_comment],

    word: ($) => $.identifier,

    // Declared so node-types.json lists which node types are actions and which are patches; the generated
    // syntax-type module turns those lists into runtime sets, so no consumer guesses from a node-type prefix.
    supertypes: ($) => [$._action, $._patch],

    // WeiDU's lexer turns every keyword into its token wherever it appears, so a keyword never reads as a bare
    // name. Without this, tree-sitter would read one as an identifier wherever the keyword itself is not expected.
    reserved: {
        global: () => RESERVED_WORDS,
    },

    conflicts: ($) => [
        [$.action_copy],
        [$.action_copy_existing],
        [$.action_copy_existing_regexp],
        [$.action_create],
        // `EVAL ~x~` is an evaluated name a statement writes, an evaluated value, or a standalone EVAL patch followed
        // by a string; only the rest of the parse distinguishes them.
        [$._var_target, $.patch_evaluate_buffer],
        [$._var_target, $.evaluated_expr, $.patch_evaluate_buffer],
        [$.evaluated_expr, $.patch_evaluate_buffer],
        [$._var_target, $.evaluated_expr, $.patch_evaluate_buffer, $.action_compile],
        [$.evaluated_expr, $.patch_evaluate_buffer, $.action_compile],
        [$._var_target, $.patch_evaluate_buffer, $.action_extend_top],
        [$._var_target, $.patch_evaluate_buffer, $.action_extend_bottom],
        // After a statement that ends in an open list of values, a name starts either one more value or the next
        // statement, which writes it (`x = 1`).
        [$.variable_ref, $._var_target],
        [$._var_target],
        [$._var_target, $._primary],
        [$._var_target, $._tight_expr],
        [$._var_target, $._operand],
        [$._var_target, $._tight_expr, $._operand],
        [$._tight_expr, $._operand],
        [$.variable_ref, $.action_at_now],
        [$.variable_ref, $.action_at_interactive_now],
        [$.variable_ref, $.assoc_entry],
        // A string list ends where the next statement starts: `x` after its items is one more item, or the start of
        // `x = 1`. Only the token after it decides.
        [$.patch_remove_store_item],
        [$.patch_remove_cre_item],
        [$.patch_remove_known_spell],
        [$.patch_include],
        [$.patch_reinclude],
        [$.patch_write_ascii_list],
        [$.patch_write_asciil],
        [$.patch_add_store_item],
        [$.patch_define_associative_array, $.action_define_associative_array],
        [$.patch_evaluate_buffer, $.action_extend_top],
        [$.patch_evaluate_buffer, $.action_extend_bottom],
        [$.patch_evaluate_buffer, $.action_compile],
        // AT_NOW ~a~ - 1: a quoted result variable before a negative command, or one command `~a~ - 1`.
        [$._primary, $.action_at_now],
        [$._primary, $.action_at_interactive_now],
        [$._tight_expr, $.action_at_now],
        [$._tight_expr, $.action_at_interactive_now],
        [$._operand, $.action_at_now],
        [$._operand, $.action_at_interactive_now],
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
                    // Flags, languages and the actions of a .tpa/.tph file
                    repeat(choice($._top_level, $._action)),
                    // Components close the file, so an action after a component's header is that component's: at
                    // the root it would tie with the component and split it from its actions.
                    repeat($.component),
                ),
                // Patch-only file (.tpp)
                $.patch_file,
            ),

        // Patch-only file (e.g., .tpp includes) - entire file is patches
        patch_file: ($) => repeat1($._patch),

        // Block bodies. Left-recursive rather than repeat(): after any statement the parser then reaches, in one
        // reduction, a state where END shifts, and that is the only token tree-sitter's recovery inserts for a block
        // still being typed. With repeat() it inserted an unrelated zero-argument action instead, and the rest of
        // the file became one ERROR.
        _action_list: ($) => choice($._action, seq($._action_list, $._action)),
        _patch_list: ($) => choice($._patch, seq($._patch_list, $._patch)),
        // Not done: wrapping a body and its END in one rule also recovers a PATCH_IF left open inside a COPY's patch
        // list, but grows the parse table by half (root ERRORs over simulated edits: 2.8% here, 1.1% with it).

        // =========================================
        // LITERALS
        // =========================================

        string: ($) => choice($.tilde_string, $.double_string, $.five_tilde_string, $.percent_string),

        // The *_content tokens come from the external scanner (see externals).
        tilde_string: ($) => seq("~", optional($.tilde_content), "~"),
        double_string: ($) => seq('"', optional($.double_content), '"'),
        five_tilde_string: ($) => seq("~~~~~", optional($.five_tilde_content), "~~~~~"),
        // WeiDU lexes `%...%` as one string token, so nothing between its delimiters is a comment: the content runs
        // to the closer, and the scanner gives the closer only right after the content or the opener (see
        // src/scanner.c), never after a comment the parser took in between.
        percent_string: ($) => seq("%", optional($.percent_content), alias($._percent_close, "%")),

        // Decimal, hex (0x), octal (0o), binary (0b), # prefix, dotted version
        // No leading `-` on the decimal form: it would swallow the operator in `%size%-12`, which WeiDU
        // reads as subtraction. Negation comes from unary_expr instead. `#-123` keeps its own sign.
        number: ($) => choice(/[0-9]+(\.[0-9]+)*/, /0[xX][0-9a-fA-F]+/, /0[oO][0-7]+/, /0[bB][01]+/, /#-?[0-9]+/),

        tra_ref: ($) => /@-?[0-9]+/,

        identifier: ($) => /[A-Za-z_][A-Za-z0-9_#-]*/,

        // Unquoted resource reference (e.g., script.bcs, 00MYFILE.itm)
        bare_resref: ($) => /[A-Za-z0-9_][A-Za-z0-9_#-]*\.[A-Za-z0-9]+/,

        // =========================================
        // COMMENTS
        // =========================================

        // A block comment closed by its matching `*/` is one external token (it nests); one never closed ends before
        // the next top-level item (see src/scanner.c) and the missing `*/` is reported. Ending the unclosed form in a
        // token keeps a run of unclosed openers linear: a scanner that declined would re-read the tail at each one.
        comment: ($) => choice($._comment_closed, seq($._comment_open, "*/")),

        // One token: as a seq, the scanner was asked between `//` and the rest and could read a `/*` there as a block
        // comment. WeiDU skips to the end of the line.
        line_comment: ($) => token(seq("//", /[^\n]*/)),

        // =========================================
        // VARIABLE REFERENCES
        // =========================================

        // No `%name%` form: WeiDU lexes `%name%` as one string token, and a percent_string reads it whole. A form of
        // separate tokens here let a comment stand between the `%` and the name. Keeping it with immediate tokens
        // instead grows the main lexer function by a seventh, for a form no corpus file reaches.
        variable_ref: ($) => choice($.identifier, $.var_name_numeric),

        // Variable name starting with a number (valid inside %...% and as array keys)
        var_name_numeric: ($) => /[0-9][A-Za-z0-9_#-]*/,

        array_access: ($) =>
            choice(
                seq("$", field("name", choice($.identifier, $.var_name_numeric, $.string)), "(", repeat($.value), ")"),
                seq("$", "EVAL", field("name", $.value), "(", repeat($.value), ")"),
            ),

        // EVAL allows evaluated variable names (e.g., EVAL $array(...))
        // A variable a statement writes: a name, as WeiDU has it in that position.
        _var_target: ($) => nameIn($, "var"),

        // A parameter or return name in a function definition or call, as the `name` field of its list or item.
        _name: ($) => nameIn($, "name"),

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

        _expr: ($) => choice($.binary_expr, $.ternary_expr, $._tight_expr),

        _tight_expr: ($) => choice(...tightExprs($)),

        // A one-string operand, as WeiDU's predicates take it: a literal or variable, an array element, or an
        // evaluated string. It ends at the string, so in `FILE_EXISTS ~a~ AND x` the AND belongs to the condition.
        _operand: ($) => choice($._primary, $.array_access, $.evaluated_expr),

        // An operand that may also be a parenthesised expression (MOD_IS_INSTALLED's component number).
        _safe_operand: ($) => choice($._operand, $.paren_expr),

        _primary: ($) => choice($.string, $.number, $.tra_ref, $.at_ref, $.bare_resref, $.variable_ref),

        at_ref: ($) => prec.right(3, seq("AT", field("ref", $._expr))),

        paren_expr: ($) => seq("(", $._expr, ")"),

        ternary_expr: ($) =>
            prec.right(
                PREC_TERNARY,
                seq(field("condition", $._expr), "?", field("then", $._expr), ":", field("else", $._expr)),
            ),

        // WeiDU's levels are all left-associative, `**` included.
        binary_expr: ($) =>
            choice(
                ...BINARY_LEVELS.map((ops, i) =>
                    prec.left(
                        PREC_TERNARY + 1 + i,
                        seq(
                            field("left", $._expr),
                            field("op", ops.length === 1 ? ops[0] : choice(...ops)),
                            field("right", $._expr),
                        ),
                    ),
                ),
            ),

        // `-` is no WeiDU operator (WeiDU reads `-1` as an error); it is kept, leniently, as a prefix negation.
        unary_expr: ($) => seq(field("op", $._unary_op), field("operand", $._tight_expr)),

        _unary_op: ($) => choice("-", "NOT", "!", "BNOT", "`", "ABS"),

        evaluated_expr: ($) => seq(choice("EVAL", "EVALUATE_BUFFER"), field("value", $._operand)),

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

        resolve_str_ref_expr: ($) => seq("RESOLVE_STR_REF", "(", field("text", $.value), ...textTail($), ")"),

        state_which_says_expr: ($) =>
            prec.right(
                3,
                seq(
                    "STATE_WHICH_SAYS",
                    field("text", $.value),
                    ...textTail($),
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
        file_is_in_compressed_biff_expr: checkExpr(
            kw("FILE_IS_IN_COMPRESSED_BIFF", "FILE_IS_IN_COMPRESSED_BIF"),
            "file",
        ),
        biff_is_compressed_expr: checkExpr("BIFF_IS_COMPRESSED", "biff"),
        file_size_expr: ($) => seq("FILE_SIZE", field("file", operand($)), field("size", operand($))),
        size_of_file_expr: checkExpr("SIZE_OF_FILE", "file"),
        valid_script_actions_expr: checkExpr("VALID_SCRIPT_ACTIONS", "text"),
        valid_script_triggers_expr: checkExpr("VALID_SCRIPT_TRIGGERS", "text"),
        file_md5_expr: ($) => seq("FILE_MD5", field("file", operand($)), field("md5", operand($))),
        // `VARIABLE_IS_SET EVAL ~%x%~` reads its name through the operand's evaluated_expr.
        variable_is_set_expr: checkExpr("VARIABLE_IS_SET", "var"),
        is_an_int_expr: checkExpr("IS_AN_INT", "var"),
        game_is_expr: ($) => seq("GAME_IS", optional($._opt_caching), field("games", operand($))),
        game_includes_expr: ($) => seq("GAME_INCLUDES", optional($._opt_caching), field("games", operand($))),
        engine_is_expr: ($) => seq("ENGINE_IS", optional($._opt_caching), field("engines", operand($))),
        string_length_expr: checkExpr("STRING_LENGTH", "string"),

        variable_is_in_array_expr: checkExpr("VARIABLE_IS_IN_ARRAY", "array"),
        defined_as_function_expr: checkExpr("DEFINED_AS_FUNCTION", "var"),
        defined_as_inlined_expr: checkExpr("DEFINED_AS_INLINED", "var"),

        mod_is_installed_expr: ($) =>
            seq("MOD_IS_INSTALLED", field("mod", operand($)), field("component", alias($._safe_operand, $.value))),

        install_order_expr: ($) =>
            seq(
                "INSTALL_ORDER",
                field("mod", operand($)),
                field("component", alias($._safe_operand, $.value)),
                choice("AFTER", "BEFORE"),
                field("other_mod", operand($)),
                field("other_component", alias($._safe_operand, $.value)),
            ),

        id_of_label_expr: ($) => seq("ID_OF_LABEL", field("tp2", operand($)), field("label", operand($))),

        file_contains_expr: ($) => seq("FILE_CONTAINS", field("file", operand($)), field("regexp", operand($))),

        // Takes a resource name and a regexp, both evaluated as patch strings.
        resource_contains_expr: ($) =>
            seq("RESOURCE_CONTAINS", field("resource", operand($)), field("regexp", operand($))),

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
                $.patch_evaluate_buffer_special,
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
                $.patch_remove_cre_items,
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
                $.patch_apply_bcs_patch,
                $.patch_refactor_trigger,
                // Arrays
                $.patch_define_array,
                $.patch_define_associative_array,
                $.patch_bash_for,
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
                $.patch_reinclude,
                $.patch_random_seed,
                $.patch_readln,
                $.patch_with_tra,
                $.patch_reraise,
                $.patch_silent,
                $.patch_verbose,
                $.patch_time,
                $.patch_write_file,
                $.patch_extend_mos,
                $.patch_edit_sav_file,
                $.patch_gam,
                $.patch_rebuild_cre_file,
                $.patch_compile_baf_to_bcs,
                $.patch_decompile_bcs_to_baf,
                $.patch_compile_d_to_dlg,
                $.patch_decompile_dlg_to_d,
                $.patch_decompile_and_patch,
                $.patch_decompress_replace_file,
                $.patch_compress_replace_file,
                $.patch_decompress_into_file,
                $.patch_compress_into_file,
                $.patch_compress_into_var,
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
                        "WRITE_ASCII_TERMINATED",
                        "WRITE_EVALUATED_ASCII",
                    ),
                    field("offset", $.value),
                    field("string", $.value),
                    optional(choice(seq("#", field("length", $.value)), seq("(", field("length", $.value), ")"))),
                ),
            ),

        patch_write_ascii_list: ($) => seq("WRITE_ASCII_LIST", field("offset", $.value), repeat(operand($))),

        patch_write_asciil: ($) => seq("WRITE_ASCIIL", field("offset", $.value), repeat(operand($))),

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
                $._var_target,
                optional(seq("ELSE", field("default", $.value))),
            ),

        patch_get_strref: getStrref("GET_STRREF", "GET_STRREF_S", "GET_STRREF_F", "GET_STRREF_FS"),

        patch_lookup_ids_symbol_of_int: ($) =>
            seq(
                choice("LOOKUP_IDS_SYMBOL_OF_INT", "SET_IDS_SYMBOL_OF_INT"),
                field("target", choice($.identifier, $.var_name_numeric, $.string)),
                field("ids_file", $.value),
                field("value", $.value),
            ),

        // String operations
        // SAY offset text [sound] [female [female_sound]]: with a female text, the first is the male PC's
        patch_say: ($) =>
            prec.right(
                seq(choice("SAY", "SAY_EVALUATED"), field("offset", $.value), field("text", $.value), ...textTail($)),
            ),

        patch_sprint: sprintOpGlobal("SPRINT"),
        patch_text_sprint: textSprintOpGlobal("TEXT_SPRINT"),

        patch_snprint: ($) =>
            prec.right(
                seq("SNPRINT", field("length", $.value), $._var_target, field("value", $.value), ...textTail($)),
            ),

        patch_sprintf: sprintfOp("SPRINTF"),

        patch_to_upper: caseConvert("TO_UPPER"),
        patch_to_lower: caseConvert("TO_LOWER"),

        patch_spaces: ($) => seq("SPACES", $._var_target, field("template", $.value)),
        patch_quote: ($) => seq("QUOTE", $._var_target, field("string", $.value)),
        patch_source_biff: ($) => seq("SOURCE_BIFF", $._var_target, field("filename", $.value)),

        // Assignment
        patch_set: ($) =>
            seq(
                "SET",
                optional("GLOBAL"),
                choice(
                    seq($._var_target, field("operator", $._assign_op), field("value", $.value)),
                    seq(choice("++", "--"), $._var_target),
                ),
            ),

        patch_assignment: ($) =>
            prec(10, seq(optional("GLOBAL"), $._var_target, field("operator", $._assign_op), field("value", $.value))),

        patch_increment: ($) => seq(optional("GLOBAL"), "++", field("var", $.value)),
        patch_decrement: ($) => seq(optional("GLOBAL"), "--", field("var", $.value)),

        _assign_op: ($) => choice("=", "+=", "-=", "*=", "/=", "|=", "&=", "<<=", ">>=", "^^="),

        // Control flow
        patch_if: ($) =>
            seq(
                "PATCH_IF",
                field("condition", $.value),
                optional("THEN"),
                "BEGIN",
                optional($._patch_list),
                "END",
                optional(
                    seq(
                        "ELSE",
                        choice(
                            seq("BEGIN", optional($._patch_list), "END"),
                            $._patch, // else-if chain or single patch
                        ),
                    ),
                ),
            ),

        patch_match: ($) => seq("PATCH_MATCH", field("value", $.value), withCases($.match_case, $._patch)),

        match_case: matchCase(($) => $._patch),

        patch_for: forLoop("FOR", ($) => $._patch),
        patch_while: whileLoop("WHILE", ($) => $._patch),
        patch_php_each: phpEachLoop("PHP_EACH", "PATCH_PHP_EACH")(($) => $._patch),

        patch_for_each: ($) =>
            seq(
                "PATCH_FOR_EACH",
                field("var", $.value),
                "IN",
                repeat($.value),
                "BEGIN",
                optional($._patch_list),
                "END",
            ),

        patch_with_scope: ($) => seq("PATCH_WITH_SCOPE", "BEGIN", optional($._patch_list), "END"),

        // Text manipulation
        patch_replace: ($) =>
            prec.right(
                seq(
                    "REPLACE",
                    optional($._opt_case),
                    optional($._opt_exact),
                    field("regexp", $.value),
                    field("replacement", $.value),
                    ...textTail($),
                ),
            ),

        // Sound reference: one token, as WeiDU lexes it - anything between the brackets, empty included.
        sound_ref: ($) => /\[[^\]]*\]/,

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
                optional($._patch_list),
                "END",
                field("replacement", $.value),
            ),

        // Buffer operations
        patch_evaluate_buffer: ($) => choice("EVALUATE_BUFFER", "EVAL"),
        patch_evaluate_buffer_special: ($) => seq("EVALUATE_BUFFER_SPECIAL", field("marker", $.value)),

        patch_insert_bytes: ($) => seq("INSERT_BYTES", field("offset", $.value), field("length", $.value)),

        patch_delete_bytes: ($) => seq("DELETE_BYTES", field("offset", $.value), field("length", $.value)),

        patch_append_file: ($) =>
            seq(choice("APPEND_FILE", "APPEND_FILE_EVALUATE"), optional("TEXT"), field("file", $.value)),

        // WRITE_FILE overwrites from the offset, INSERT_FILE inserts there.
        patch_write_file: ($) =>
            seq(choice("WRITE_FILE", "INSERT_FILE"), field("offset", $.value), field("file", $.value)),

        patch_extend_mos: ($) => seq("EXTEND_MOS", field("file", $.value), field("amount", $.value)),

        patch_edit_sav_file: ($) =>
            seq(
                "EDIT_SAV_FILE",
                field("compression", $.value),
                optional("ADD_IF_MISSING"),
                repeat(field("file", $.value)),
                "BEGIN",
                optional($._patch_list),
                "END",
            ),

        patch_gam: ($) =>
            seq(
                choice("PATCH_GAM", "ADD_GAM_NPC", "ADD_GAME_NPC"),
                field("cre", $.value),
                field("area", $.value),
                field("x", $.value),
                field("y", $.value),
            ),

        patch_apply_bcs_patch: ($) =>
            choice(
                seq(kw("APPLY_BCS_PATCH", "A_B_P"), field("patch", $.value)),
                seq("APPLY_BCS_PATCH_OR_COPY", field("patch", $.value), field("copy", $.value)),
            ),

        patch_refactor_trigger: ($) =>
            seq(
                choice("REFACTOR_TRIGGER", "REFACTOR_D_TRIGGER", "REFACTOR_BAF_TRIGGER"),
                optional($._opt_case),
                optional($._opt_exact),
                field("old", $.value),
                field("new", $.value),
            ),

        patch_rebuild_cre_file: ($) => "REBUILD_CRE_FILE",

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

        patch_count_2da_cols: ($) => seq("COUNT_2DA_COLS", $._var_target),

        patch_count_2da_rows: ($) => seq("COUNT_2DA_ROWS", field("req_cols", $.value), $._var_target),

        patch_count_regexp_instances: ($) =>
            seq(
                "COUNT_REGEXP_INSTANCES",
                optional($._opt_case),
                optional($._opt_exact),
                field("pattern", $.value),
                $._var_target,
            ),

        patch_pretty_print_2da: ($) => seq("PRETTY_PRINT_2DA", optional(seq("(", field("columns", $.value), ")"))),

        patch_insert_2da_row: ($) =>
            seq("INSERT_2DA_ROW", field("row", $.value), field("req_cols", $.value), field("value", $.value)),

        patch_remove_2da_row: ($) => seq("REMOVE_2DA_ROW", field("row", $.value), field("req_cols", $.value)),

        // Seven values (offset, offset size, count, count size, index, index size, entry length), or a preset that
        // names a known file structure.
        patch_get_offset_array: ($) =>
            seq("GET_OFFSET_ARRAY", $._var_target, choice(repeatN($.value, 7), $.offset_array_preset)),

        // As GET_OFFSET_ARRAY with the parent offset first: eight values, or that offset and a preset.
        patch_get_offset_array2: ($) =>
            seq("GET_OFFSET_ARRAY2", $._var_target, choice(repeatN($.value, 8), seq($.value, $.offset_array2_preset))),

        offset_array_preset: ($) => choice(...OFFSET_ARRAY_PRESETS),
        offset_array2_preset: ($) => choice(...OFFSET_ARRAY2_PRESETS),

        // Store/CRE item operations (using helpers)
        // String lists (here and REMOVE_CRE_ITEM, REMOVE_KNOWN_SPELL, PATCH_INCLUDE, WRITE_ASCII_LIST) take one-string
        // items, as in WeiDU, so `x = 1` on the next line is an assignment, not one more item.
        patch_remove_store_item: ($) => seq("REMOVE_STORE_ITEM", repeat(field("item", operand($)))),

        // ADD_STORE_ITEM [+] item [position] charge1 charge2 charge3 flags stock [unlimited]; only `+` (overwrite)
        // is a flag here. A position of AT value reads as an AT-reference value, which keeps the count the same.
        patch_add_store_item: ($) =>
            seq(
                "ADD_STORE_ITEM",
                optional("+"),
                field("item", $.value),
                optional(choice("FIRST", "LAST", seq(choice("AFTER", "BEFORE"), field("position", $.value)))),
                repeatN($.value, 5),
                optional($.value),
            ),

        // item charge1 charge2 charge3 flags slot, then the switches; only ADD_CRE_ITEM has NOMOVE.
        patch_replace_cre_item: ($) =>
            seq("REPLACE_CRE_ITEM", repeatN($.value, 6), optional("EQUIP"), optional("TWOHANDED")),
        patch_remove_cre_item: itemPatch("REMOVE_CRE_ITEM"),
        // REMOVE_CRE_ITEMS (plural, no argument) strips every item from the CRE, unlike the
        // singular REMOVE_CRE_ITEM ~resref~ which removes one named item.
        patch_remove_cre_items: ($) => "REMOVE_CRE_ITEMS",
        patch_add_cre_item: ($) =>
            seq("ADD_CRE_ITEM", repeatN($.value, 6), optional("EQUIP"), optional("TWOHANDED"), optional("NOMOVE")),

        patch_add_memorized_spell: ($) =>
            prec.right(
                seq(
                    "ADD_MEMORIZED_SPELL",
                    field("spell", $.value),
                    field("level", $.value),
                    field("type", $.value),
                    optional(choice(seq("(", field("count", $.value), ")"), field("count", $.number))),
                ),
            ),

        patch_remove_memorized_spell: ($) => prec.right(seq("REMOVE_MEMORIZED_SPELL", repeat($.value))),
        patch_remove_memorized_spells: ($) => "REMOVE_MEMORIZED_SPELLS",
        patch_remove_known_spells: ($) => "REMOVE_KNOWN_SPELLS",
        patch_remove_cre_effects: ($) => "REMOVE_CRE_EFFECTS",

        patch_add_known_spell: ($) =>
            seq("ADD_KNOWN_SPELL", field("spell", $.value), field("level", $.value), field("type", $.value)),

        patch_remove_known_spell: ($) => seq("REMOVE_KNOWN_SPELL", repeat(field("spell", operand($)))),

        patch_add_map_note: ($) =>
            prec.right(
                seq(
                    "ADD_MAP_NOTE",
                    field("x", $.value),
                    field("y", $.value),
                    field("color", $.value),
                    field("strref", $.value),
                    ...textTail($),
                ),
            ),

        patch_set_bg2_proficiency: ($) =>
            seq("SET_BG2_PROFICIENCY", field("proficiency", $.value), field("value", $.value)),

        // Functions
        patch_launch_function: ($) =>
            seq(
                choice("LAUNCH_PATCH_FUNCTION", "LAUNCH_FUNCTION_PATCH", "LPF"),
                field("name", choice($.identifier, $.var_name_numeric, $.string)),
                repeat($._func_call_param),
                "END",
            ),

        patch_launch_macro: ($) =>
            seq(
                choice("LAUNCH_PATCH_MACRO", "LAUNCH_MACRO_PATCH", "LPM"),
                field("name", choice($.identifier, $.var_name_numeric, $.string)),
            ),

        patch_replace_bcs_block: ($) =>
            prec.right(
                seq(
                    choice(
                        seq(kw("REPLACE_BCS_BLOCK", "R_B_B"), optional("EVALUATE_BUFFER"), optional($._opt_case)),
                        kw("REPLACE_BCS_BLOCK_REGEXP", "R_B_B_RE"),
                    ),
                    field("file", $.string),
                    field("file", $.string),
                    optional(seq("ON_MISMATCH", optional($._patch_list), "END")),
                ),
            ),

        // Arrays
        patch_define_array: ($) =>
            seq(choice("DEFINE_ARRAY", "PATCH_DEFINE_ARRAY"), field("name", $.value), "BEGIN", repeat($.value), "END"),
        patch_define_associative_array: defineAssocArray(
            kw("DEFINE_ASSOCIATIVE_ARRAY", "PATCH_DEFINE_ASSOCIATIVE_ARRAY"),
        ),
        patch_clear_array: clearArray(kw("CLEAR_ARRAY", "PATCH_CLEAR_ARRAY")),

        patch_sort_array_indices: sortArrayIndices("SORT_ARRAY_INDICES"),

        assoc_entry: ($) =>
            seq(
                field("key", choice($.value, $.var_name_numeric)),
                repeat(seq(",", field("key", $.value))),
                "=>",
                field("value", $.value),
            ),

        // Print/log operations (using helpers)
        patch_print: printOp("PATCH_PRINT"),
        patch_log: printOp("PATCH_LOG"),
        patch_warn: printOp("PATCH_WARN"),
        patch_fail: printOp("PATCH_FAIL"),
        patch_abort: printOp("PATCH_ABORT"),

        patch_include: ($) => seq("PATCH_INCLUDE", repeat(field("file", operand($)))),
        patch_reinclude: ($) => seq("PATCH_REINCLUDE", repeat(field("file", operand($)))),
        patch_random_seed: ($) => seq("PATCH_RANDOM_SEED", $.value),
        patch_readln: ($) => seq("PATCH_READLN", $.value),
        patch_with_tra: ($) =>
            seq("PATCH_WITH_TRA", repeat(field("file", $.value)), "BEGIN", optional($._patch_list), "END"),
        patch_reraise: ($) => "PATCH_RERAISE",
        patch_silent: ($) => "PATCH_SILENT",
        patch_time: ($) => seq("PATCH_TIME", field("name", $.value), "BEGIN", optional($._patch_list), "END"),
        patch_verbose: ($) => "PATCH_VERBOSE",
        patch_compile_baf_to_bcs: ($) => "COMPILE_BAF_TO_BCS",
        patch_decompile_bcs_to_baf: ($) => "DECOMPILE_BCS_TO_BAF",
        patch_compile_d_to_dlg: ($) => "COMPILE_D_TO_DLG",
        patch_decompile_dlg_to_d: ($) => "DECOMPILE_DLG_TO_D",

        patch_decompile_and_patch: ($) => seq("DECOMPILE_AND_PATCH", "BEGIN", optional($._patch_list), "END"),

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

        patch_decompress_into_file: ($) =>
            seq(
                "DECOMPRESS_INTO_FILE",
                field("start", $.value),
                field("length", $.value),
                field("uncompressed_length", $.value),
                field("overwrite_from", $.value),
                field("overwrite_to", $.value),
            ),

        patch_compress_into_file: ($) =>
            seq(
                "COMPRESS_INTO_FILE",
                field("start", $.value),
                field("length", $.value),
                field("level", $.value),
                field("overwrite_from", $.value),
                field("overwrite_to", $.value),
            ),

        patch_compress_into_var: ($) =>
            seq(
                "COMPRESS_INTO_VAR",
                field("start", $.value),
                field("length", $.value),
                field("level", $.value),
                $._var_target,
            ),

        patch_decompress_into_var: ($) =>
            seq(
                "DECOMPRESS_INTO_VAR",
                field("offset", $.value),
                field("compressed_size", $.value),
                field("uncompressed_size", $.value),
                $._var_target,
            ),

        patch_try: tryBlock(
            "PATCH_TRY",
            ($) => $._patch,
            ($) => $.match_case,
        ),

        inner_patch: innerPatchOp("INNER_PATCH"),

        inner_patch_save: ($) =>
            seq("INNER_PATCH_SAVE", $._var_target, field("buffer", $.value), "BEGIN", optional($._patch_list), "END"),

        inner_patch_file: ($) =>
            seq("INNER_PATCH_FILE", field("file", $.value), "BEGIN", optional($._patch_list), "END"),

        inner_action: ($) => seq("INNER_ACTION", "BEGIN", optional($._action_list), "END"),

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
                $.action_append_col_outer,
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
                $.action_outer_snprint,
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
                $.action_define_dimorphic_function,
                $.action_launch_macro,
                $.action_launch_function,
                // Arrays
                $.action_define_array,
                $.action_define_associative_array,
                $.action_clear_array,
                $.action_sort_array_indices,
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
                $.action_abort,
                $.require_file_flag,
                $.forbid_file_flag,
                $.action_clear_memory,
                $.action_silent,
                $.action_verbose,
                $.action_to_upper,
                $.action_to_lower,
                $.action_get_strref,
                $.action_disable_from_key,
                $.action_get_resource_array,
                $.action_alter_tlk_list,
                $.action_alter_tlk,
                $.action_alter_tlk_range,
                $.action_reraise,
                $.action_time,
                $.action_add_school,
                $.action_copy_kit,
                $.action_string_set_range,
                $.action_get_file_array,
                $.action_get_directory_array,
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
                repeat($.file_pair),
                optional($.patches),
                optional($.when),
            ),

        action_copy_existing: ($) =>
            seq(
                "COPY_EXISTING",
                optional($._opt_no_backup),
                repeat($.file_pair),
                optional($.patches),
                optional($.when),
            ),

        action_copy_existing_regexp: ($) =>
            seq(
                "COPY_EXISTING_REGEXP",
                optional($._opt_no_backup),
                optional($._opt_glob),
                repeat($.file_pair),
                optional($.patches),
                optional($.when),
            ),

        action_copy_large: ($) => seq("COPY_LARGE", optional("+"), optional($._opt_glob), repeat($.file_pair)),

        // COPY_RANDOM (file...) (file...) ... [patches] [when], or a bare file list.
        action_copy_random: ($) =>
            prec.right(
                seq(
                    "COPY_RANDOM",
                    // The bare list holds strings only, as in WeiDU, so `(` always opens a group.
                    choice(repeat1($.copy_random_item), repeat(choice($.string, $.identifier))),
                    optional($.patches),
                    optional($.when),
                ),
            ),

        copy_random_item: ($) => seq("(", repeat($.value), ")"),

        action_copy_all_gam_files: ($) => prec.right(seq("COPY_ALL_GAM_FILES", optional($.patches), optional($.when))),

        file_pair: ($) => seq(field("from", $.value), field("to", $.value)),

        // Patches inside actions - either bare patches or BEGIN/END block
        // Named rule (not hidden) so context detection can find it in AST
        patches: ($) => prec.right(choice(repeat1($._patch), $.patch_block)),

        patch_block: ($) => prec(-10, seq("BEGIN", optional($._patch_list), "END")),

        // When clause: IF_SIZE_IS, IF regexp, UNLESS regexp, IF_EXISTS, BUT_ONLY, BUT_ONLY_IF_IT_CHANGES
        // All can appear in any order, multiple IF/UNLESS allowed
        when: ($) =>
            prec.right(
                repeat1(
                    choice(
                        seq("IF", field("if_resource", $.value)),
                        seq("UNLESS", field("unless_resource", $.value)),
                        seq(kw("IF_SIZE_IS", "I_S_I"), field("size", $.value)),
                        seq("IF_EVAL", field("condition", $.value)),
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
                    repeat(field("source", $.value)),
                    optional(choice("EVALUATE_BUFFER", "EVAL")),
                    optional($._patch_list),
                    optional(seq("USING", repeat(field("tra", $.value)))),
                ),
            ),

        action_extend_top: extendAction("EXTEND_TOP", "EXTEND_TOP_REGEXP"),
        action_extend_bottom: extendAction("EXTEND_BOTTOM", "EXTEND_BOTTOM_REGEXP"),

        action_append: appendAction("APPEND"),
        action_append_col: appendColAction("APPEND_COL"),

        action_append_outer: appendAction("APPEND_OUTER"),
        action_append_col_outer: appendColAction("APPEND_COL_OUTER"),

        action_delete: ($) => prec.right(seq("DELETE", optional("+"), repeat(field("file", $.value)))),

        action_move: ($) => prec.right(seq("MOVE", optional("+"), repeat(choice($.file_pair, $.move_regexp)))),

        // MOVE (directory [EXACT_MATCH | EVALUATE_REGEXP] pattern) destination: every match goes to destination.
        move_regexp: ($) =>
            seq(
                "(",
                field("dir", $.value),
                optional($._opt_exact),
                field("pattern", $.value),
                ")",
                field("to", $.value),
            ),

        action_mkdir: ($) => prec.right(seq("MKDIR", repeat(field("dir", $.value)))),

        action_create: ($) =>
            seq(
                "CREATE",
                field("type", choice($.identifier, $.string)),
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
                optional($._action_list),
                "END",
                optional(
                    seq(
                        "ELSE",
                        choice(
                            seq("BEGIN", optional($._action_list), "END"),
                            $._action, // Single action without BEGIN...END, an ACTION_IF chain included
                        ),
                    ),
                ),
            ),

        action_match: ($) => seq("ACTION_MATCH", field("value", $.value), withCases($.action_match_case, $._action)),

        action_match_case: matchCase(($) => $._action),

        action_try: tryBlock(
            "ACTION_TRY",
            ($) => $._action,
            ($) => $.action_match_case,
        ),

        outer_for: forLoop("OUTER_FOR", ($) => $._action),
        outer_while: whileLoop("OUTER_WHILE", ($) => $._action),

        action_for_each: ($) =>
            prec.right(
                seq(
                    "ACTION_FOR_EACH",
                    field("var", $.value),
                    "IN",
                    repeat($.value),
                    "BEGIN",
                    optional($._action_list),
                    "END",
                ),
            ),

        action_php_each: phpEachLoop("ACTION_PHP_EACH")(($) => $._action),

        // Variables
        action_outer_set: ($) =>
            seq(
                "OUTER_SET",
                optional("GLOBAL"),
                choice(
                    seq($._var_target, field("operator", $._assign_op), field("value", $.value)),
                    seq(choice("++", "--"), $._var_target),
                ),
            ),

        action_outer_sprint: sprintOpGlobal("OUTER_SPRINT"),
        action_outer_text_sprint: textSprintOpGlobal("OUTER_TEXT_SPRINT"),

        action_outer_sprintf: sprintfOp("OUTER_SPRINTF"),
        action_outer_snprint: ($) =>
            seq("OUTER_SNPRINT", field("length", $.value), $._var_target, field("value", $.value), ...textTail($)),

        // Local variables (only valid inside macro bodies)
        // LOCAL_SET takes plain `=` only; WeiDU has no compound form of it.
        local_set: ($) => seq("LOCAL_SET", $._var_target, field("operator", "="), field("value", $.value)),
        // LOCAL_SPRINT takes a text with its sound and female forms; LOCAL_TEXT_SPRINT a plain string.
        local_sprint: ($) =>
            choice(
                prec.right(seq("LOCAL_SPRINT", $._var_target, field("value", $.value), ...textTail($))),
                seq("LOCAL_TEXT_SPRINT", $._var_target, field("value", $.value)),
            ),

        action_with_tra: ($) =>
            seq("WITH_TRA", repeat(field("file", $.value)), "BEGIN", optional($._action_list), "END"),

        action_with_scope: ($) => seq("WITH_SCOPE", "BEGIN", optional($._action_list), "END"),

        // ADD_JOURNAL [EXISTING] [MANAGED] [TITLE (text)] reference list [USING traFile list]
        action_add_journal: ($) =>
            prec.right(
                seq(
                    "ADD_JOURNAL",
                    optional("EXISTING"),
                    optional("MANAGED"),
                    optional(seq("TITLE", "(", field("title", $.value), ...textTail($), ")")),
                    repeat($.value),
                    optional(seq("USING", repeat(field("tra", $.value)))),
                ),
            ),

        action_outer_patch: outerPatchAction("OUTER_PATCH"),
        action_outer_patch_save: outerPatchSaveAction("OUTER_PATCH_SAVE"),
        action_outer_inner_patch: outerPatchAction("OUTER_INNER_PATCH"),
        action_outer_inner_patch_save: outerPatchSaveAction("OUTER_INNER_PATCH_SAVE"),

        // Includes
        action_include: ($) => prec.right(seq(kw("INCLUDE", "ACTION_INCLUDE"), repeat(field("file", $.value)))),
        action_reinclude: ($) =>
            prec.right(seq(choice("REINCLUDE", "ACTION_REINCLUDE"), repeat(field("file", $.value)))),

        // Functions/macros definitions (using helpers)
        action_define_macro: defineMacro(kw("DEFINE_ACTION_MACRO", "DEFINE_MACRO_ACTION"), ($) => $._action),
        action_define_patch_macro: defineMacro(kw("DEFINE_PATCH_MACRO", "DEFINE_MACRO_PATCH"), ($) => $._patch),
        action_define_function: defineFunction(
            kw("DEFINE_ACTION_FUNCTION", "DEFINE_FUNCTION_ACTION"),
            ($) => $._action,
        ),
        action_define_patch_function: defineFunction(
            kw("DEFINE_PATCH_FUNCTION", "DEFINE_FUNCTION_PATCH"),
            ($) => $._patch,
        ),
        // Dimorphic: an action-list body (per WeiDU syntax), launchable via BOTH LAF and LPF.
        action_define_dimorphic_function: defineFunction("DEFINE_DIMORPHIC_FUNCTION", ($) => $._action),

        _func_decl_param: ($) => choice($.int_var_decl, $.str_var_decl, $.ret_decl, $.ret_array_decl),

        // Every parameter list, here and in calls, may be empty: WeiDU accepts it, and parameter-name completion
        // right after typing `INT_VAR ` finds its context from the (still empty) list node.
        // Each name has exactly one default, so the i-th `name` and the i-th `default` field are one parameter.
        int_var_decl: ($) => seq("INT_VAR", repeat(seq($._name, "=", field("default", $.value)))),

        str_var_decl: ($) => seq("STR_VAR", repeat(seq($._name, "=", field("default", $.value)))),

        ret_decl: ($) => seq("RET", repeat($._name)),
        ret_array_decl: ($) => seq("RET_ARRAY", repeat($._name)),

        // Function/macro calls
        action_launch_macro: ($) =>
            seq(
                choice("LAUNCH_ACTION_MACRO", "LAUNCH_MACRO_ACTION", "LAM"),
                field("name", choice($.identifier, $.var_name_numeric, $.string)),
            ),

        action_launch_function: ($) =>
            seq(
                choice("LAUNCH_ACTION_FUNCTION", "LAUNCH_FUNCTION_ACTION", "LAF"),
                field("name", choice($.identifier, $.var_name_numeric, $.string)),
                repeat($._func_call_param),
                "END",
            ),

        _func_call_param: ($) => choice($.int_var_call, $.str_var_call, $.ret_call, $.ret_array_call),

        // In function calls, left-hand side of assignments is always an identifier/string, not an expression
        int_var_call: ($) => seq("INT_VAR", repeat($.int_var_call_item)),
        int_var_call_item: ($) => seq($._name, optional(seq("=", field("value", $.value)))),
        str_var_call: ($) => seq("STR_VAR", repeat($.str_var_call_item)),
        str_var_call_item: ($) => seq($._name, optional(seq("=", field("value", $.value)))),
        ret_call: ($) => seq("RET", repeat($.ret_call_item)),
        ret_call_item: ($) => seq($._name, optional(seq("=", field("value", $.value)))),
        ret_array_call: ($) => seq("RET_ARRAY", repeat($.ret_array_call_item)),
        ret_array_call_item: ($) => seq($._name, optional(seq("=", field("value", $.value)))),

        // Arrays
        action_define_array: ($) =>
            seq("ACTION_DEFINE_ARRAY", field("name", $.value), "BEGIN", repeat(choice($.value, $.assoc_entry)), "END"),

        action_define_associative_array: defineAssocArray(
            "ACTION_DEFINE_ASSOCIATIVE_ARRAY",
            "DEFINE_ASSOCIATIVE_ARRAY",
        ),

        action_clear_array: clearArray("ACTION_CLEAR_ARRAY"),
        action_sort_array_indices: sortArrayIndices("ACTION_SORT_ARRAY_INDICES"),

        // String/tra operations
        // WeiDU allows several strref/string pairs per statement, but a pair's string may itself be a
        // male/female tlk string, and the two readings are ambiguous for the same input. One entry is
        // modelled here so the male/female form - which EET and others do write - parses unambiguously;
        // the multi-pair form is consequently REJECTED, not merely unmodelled. Nothing in the sample set or
        // the external corpus writes it (0 of 324 STRING_SET uses), so the trade favours the common form.
        action_string_set: ($) =>
            prec.right(
                seq(
                    choice("STRING_SET", "STRING_SET_EVALUATE"),
                    // WeiDU's pair list may be empty.
                    optional(seq(field("strref", $.value), field("male", $.value), ...textTail($))),
                    // WeiDU: ... USING e2:STRING - names the one tra file the references resolve against.
                    optional(seq("USING", field("tra", $.value))),
                ),
            ),

        action_load_tra: ($) => prec.right(seq("LOAD_TRA", repeat(field("file", $.value)))),

        // Game data modification
        action_add_sectype: ($) =>
            prec.right(seq("ADD_SECTYPE", field("name", $.value), field("label", $.value), ...textTail($))),

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
                    // A when list, or the IF_EXISTING / ON_DISABLE patch blocks - never both.
                    optional(
                        choice(
                            $.when,
                            seq($.add_spell_if_existing, optional($.add_spell_on_disable)),
                            $.add_spell_on_disable,
                        ),
                    ),
                ),
            ),

        add_spell_if_existing: ($) => seq("IF_EXISTING", optional($._patch_list), "END"),
        add_spell_on_disable: ($) => seq("ON_DISABLE", optional($._patch_list), "END"),

        action_add_kit: ($) => prec.right(seq("ADD_KIT", repeat1(choice($.value, $.kit_say)))),

        kit_say: ($) => prec.right(seq("SAY", $.value, ...textTail($))),

        action_add_projectile: ($) =>
            prec.right(seq("ADD_PROJECTILE", field("file", $.value), optional(field("name", $.value)))),

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
        // The optional result variable takes any of WeiDU's name forms; one string alone is the command.
        action_at_now: ($) => seq("AT_NOW", optional(nameIn($, "var")), field("command", $.value), optional("EXACT")),
        action_at_interactive_now: ($) =>
            seq("AT_INTERACTIVE_NOW", optional(nameIn($, "var")), field("command", $.value), optional("EXACT")),

        patch_bash_for: ($) =>
            prec.right(seq("PATCH_BASH_FOR", repeat($.directory_file_regexp), "BEGIN", optional($._patch_list), "END")),

        action_bash_for: ($) =>
            seq("ACTION_BASH_FOR", repeat($.directory_file_regexp), "BEGIN", optional($._action_list), "END"),

        action_decompress_biff: ($) => prec.right(seq("DECOMPRESS_BIFF", repeat(field("file", $.value)))),

        action_make_biff: ($) =>
            seq(kw("MAKE_BIFF", "BIFF"), field("name", $.value), "BEGIN", repeat($.directory_file_regexp), "END"),

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
        action_abort: printOp("ABORT"),

        action_clear_memory: ($) =>
            choice("CLEAR_MEMORY", "CLEAR_ARRAYS", "CLEAR_CODES", "CLEAR_INLINED", "CLEAR_EVERYTHING", "CLEAR_IDS_MAP"),

        action_random_seed: ($) => seq("RANDOM_SEED", $.value),

        action_readln: ($) => seq("ACTION_READLN", $.value),

        action_silent: ($) => "SILENT",
        action_verbose: ($) => "VERBOSE",

        // Case conversion (using helpers)
        action_to_upper: caseConvert("ACTION_TO_UPPER"),
        action_to_lower: caseConvert("ACTION_TO_LOWER"),

        action_get_strref: getStrref(
            "ACTION_GET_STRREF",
            "ACTION_GET_STRREF_F",
            "ACTION_GET_STRREF_S",
            "ACTION_GET_STRREF_FS",
        ),

        action_disable_from_key: ($) => prec.right(seq("DISABLE_FROM_KEY", repeat(field("resource", $.value)))),

        action_get_resource_array: ($) => seq("GET_RESOURCE_ARRAY", field("name", $.value), field("regexp", $.value)),

        action_get_file_array: fileArray("GET_FILE_ARRAY"),
        action_get_directory_array: fileArray("GET_DIRECTORY_ARRAY"),

        action_alter_tlk_list: ($) =>
            seq("ALTER_TLK_LIST", "BEGIN", repeat($.value), "END", "BEGIN", optional($._patch_list), "END"),
        action_alter_tlk: ($) => seq("ALTER_TLK", "BEGIN", optional($._patch_list), "END"),
        action_alter_tlk_range: ($) =>
            seq(
                "ALTER_TLK_RANGE",
                field("from", $.value),
                field("to", $.value),
                "BEGIN",
                optional($._patch_list),
                "END",
            ),

        action_reraise: ($) => "ACTION_RERAISE",
        action_time: ($) => seq("ACTION_TIME", field("name", $.value), "BEGIN", optional($._action_list), "END"),

        action_add_school: ($) =>
            prec.right(seq("ADD_SCHOOL", field("name", $.value), field("description", $.value), ...textTail($))),

        // COPY_KIT old new ( column value ... ): the parenthesised list holds 2DA column/value pairs.
        action_copy_kit: ($) =>
            seq("COPY_KIT", field("old", $.value), field("new", $.value), "(", repeat(seq($.value, $.value)), ")"),

        action_string_set_range: ($) =>
            seq("STRING_SET_RANGE", field("from", $.value), field("to", $.value), "USING", field("tra", $.value)),

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
                $.quick_menu_directive,
                $.ask_every_component_flag,
                $.script_style_directive,
                $.menu_style_directive,
                $.load_directive,
                $.uninstall_order_directive,
                $.modder_directive,
                $.language_directive,
                $.always_block,
            ),

        backup_directive: ($) => seq("BACKUP", field("path", $.value)),
        author_directive: ($) => seq("AUTHOR", field("email", $.value)),
        support_directive: ($) => seq("SUPPORT", field("url", $.value)),
        version_flag: ($) => prec.right(seq("VERSION", field("version", $.value), ...textTail($))),
        readme_directive: ($) => prec.right(seq("README", repeat(field("path", $.value)))),
        no_if_eval_bug_flag: ($) => "NO_IF_EVAL_BUG",
        auto_eval_strings_flag: ($) => "AUTO_EVAL_STRINGS",
        allow_missing_directive: ($) => prec.right(seq("ALLOW_MISSING", repeat(field("file", $.value)))),
        auto_tra_directive: ($) =>
            prec.right(seq("AUTO_TRA", field("path", $.value), optional(field("path", $.value)))),

        // QUICK_MENU ALWAYS_ASK <components> END (<label> BEGIN <components> END)* END
        quick_menu_directive: ($) =>
            seq(
                "QUICK_MENU",
                "ALWAYS_ASK",
                repeat(field("always_ask", $.value)),
                "END",
                repeat($.quick_menu_entry),
                "END",
            ),

        quick_menu_entry: ($) =>
            seq(field("name", $.value), ...textTail($), "BEGIN", repeat(field("component", $.value)), "END"),

        ask_every_component_flag: ($) => "ASK_EVERY_COMPONENT",
        script_style_directive: ($) => seq("SCRIPT_STYLE", field("style", $.value)),
        // MENU_STYLE takes exactly one style argument; a second is a parse error in WeiDU.
        menu_style_directive: ($) => seq("MENU_STYLE", field("style", $.value)),
        // LOAD takes a list, like the other list-taking directives above.
        load_directive: ($) => prec.right(seq("LOAD", repeat(field("file", $.value)))),
        uninstall_order_directive: ($) => prec.right(seq("UNINSTALL_ORDER", repeat(field("op", $.value)))),
        // MODDER takes option/value pairs: MODDER ~SETUP_DEBUG~ ~ON~ ~ASSERT~ ~FAIL~
        modder_directive: ($) =>
            prec.right(seq("MODDER", repeat(seq(field("option", $.value), field("value", $.value))))),

        language_directive: ($) =>
            prec.right(
                seq(
                    "LANGUAGE",
                    field("name", $.value),
                    field("directory", $.value),
                    repeat(field("tra_file", $.value)),
                ),
            ),

        component: ($) =>
            seq(
                alias("BEGIN", $.component_begin),
                field("name", $.value),
                ...textTail($),
                repeat($._componentFlag),
                optional($._action_list),
            ),

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
                $.forced_subcomponent_flag,
                $.metadata_flag,
                $.no_log_record_flag,
                $.install_by_default_flag,
            ),

        designated_flag: ($) => seq("DESIGNATED", field("number", choice($.number, $.string))),
        deprecated_flag: ($) => prec.right(seq("DEPRECATED", field("message", $.value), ...textTail($))),
        // All three of these take an optional predicate expression after the label, which WeiDU evaluates to
        // decide whether the component is offered.
        subcomponent_flag: ($) =>
            seq(
                kw("SUBCOMPONENT", "SUB_COMPONENT"),
                field("name", $.value),
                optional($.sound_ref),
                optional(field("predicate", $.value)),
            ),
        forced_subcomponent_flag: ($) =>
            seq(
                "FORCED_SUBCOMPONENT",
                field("name", $.value),
                optional($.sound_ref),
                optional(field("predicate", $.value)),
            ),
        metadata_flag: ($) => seq("METADATA", field("value", $.value)),
        no_log_record_flag: ($) => "NO_LOG_RECORD",
        install_by_default_flag: ($) => "INSTALL_BY_DEFAULT",
        group_flag: ($) =>
            seq("GROUP", field("name", $.value), optional($.sound_ref), optional(field("predicate", $.value))),
        label_flag: ($) => seq("LABEL", field("label", $.value)),
        require_predicate_flag: ($) =>
            prec.right(
                seq("REQUIRE_PREDICATE", field("predicate", $.value), field("message", $.value), ...textTail($)),
            ),
        require_component_flag: ($) =>
            seq(
                "REQUIRE_COMPONENT",
                field("file", $.value),
                field("component", $.value),
                field("message", $.value),
                ...textTail($),
            ),
        forbid_component_flag: ($) =>
            seq(
                "FORBID_COMPONENT",
                field("file", $.value),
                field("component", $.value),
                field("message", $.value),
                ...textTail($),
            ),
        // REQUIRE_FILE / FORBID_FILE take a file and a required message. They are actions in WeiDU, legal anywhere
        // an action is; the node names keep their history as component flags.
        require_file_flag: ($) =>
            prec.right(seq("REQUIRE_FILE", field("file", $.value), field("message", $.value), ...textTail($))),
        forbid_file_flag: ($) =>
            prec.right(seq("FORBID_FILE", field("file", $.value), field("message", $.value), ...textTail($))),

        always_block: ($) => seq("ALWAYS", optional($._action_list), "END"),

        inlined_file: ($) => seq(field("filename", $.inlined_filename), field("body", $.inlined_body), ">>>>>>>>"),
        // Start marker + optional space + filename on same line
        inlined_filename: ($) => /<<<<<<<<[ \t]*[^\n]*/,
        // Body: any content until >>>>>>>>. Allows up to 7 consecutive > chars
        inlined_body: ($) => /([^>]|>[^>]|>>[^>]|>>>[^>]|>>>>[^>]|>>>>>[^>]|>>>>>>[^>]|>>>>>>>[^>])*/,
    },
});
