; Highlight queries for WeiDU TP2 (mod installer) files.
; Capture names follow Neovim conventions with dot-separated fallback.
;
; TextMate scope mapping:
;   support.function.weidu-tp2.action     -> @function.builtin (actions)
;   entity.name.function.weidu-tp2.patch  -> @function (patches)
;   keyword.control.weidu-tp2             -> @keyword (control flow)
;   keyword.other.weidu-tp2               -> @keyword (structural)
;   constant.language.flag.weidu-tp2      -> @keyword.modifier (flags)
;   constant.language.weidu-tp2           -> @constant.builtin (nullary exprs)
;   variable.parameter.weidu-tp2          -> @variable
;   string.quoted.*.weidu-tp2             -> @string
;   constant.numeric.weidu-tp2            -> @number
;   comment.*                             -> @comment

; ----- Comments -----

(comment) @comment
(line_comment) @comment

; ----- Directives (top-level file structure) -----

"BACKUP" @keyword.directive
"AUTHOR" @keyword.directive
"README" @keyword.directive
"VERSION" @keyword.directive
"AUTO_TRA" @keyword.directive
"SUPPORT" @keyword.directive

; ----- Language directive -----

"LANGUAGE" @keyword.directive

; ----- Component -----

(component_begin) @function.builtin
"SUBCOMPONENT" @function.builtin

; ----- Actions (top-level commands) -----
; TextMate: support.function.weidu-tp2.action -> @function.builtin

"COPY" @function.builtin
"COPY_EXISTING" @function.builtin
"COPY_EXISTING_REGEXP" @function.builtin
"COPY_LARGE" @function.builtin
"COPY_RANDOM" @function.builtin
"COPY_ALL_GAM_FILES" @function.builtin
"COMPILE" @function.builtin
"EXTEND_TOP" @function.builtin
"EXTEND_BOTTOM" @function.builtin
"APPEND" @function.builtin
"APPEND_OUTER" @function.builtin
"APPEND_COL" @function.builtin
"INCLUDE" @function.builtin
"REINCLUDE" @function.builtin
"ACTION_REINCLUDE" @function.builtin
"CREATE" @function.builtin
"DELETE" @function.builtin
"DISABLE_FROM_KEY" @function.builtin
"MOVE" @function.builtin
"MKDIR" @function.builtin
"MAKE_BIFF" @function.builtin
"DECOMPRESS_BIFF" @function.builtin
"LOAD_TRA" @function.builtin
"STRING_SET" @function.builtin
"STRING_SET_EVALUATE" @function.builtin
"REGISTER_UNINSTALL" @function.builtin
"UNINSTALL" @function.builtin
"ADD_JOURNAL" @function.builtin
"ADD_KIT" @function.builtin
"ADD_MUSIC" @function.builtin
"ADD_PROJECTILE" @function.builtin
"ADD_SPELL" @function.builtin
"ADD_SECTYPE" @function.builtin
"ADD_AREA_TYPE" @function.builtin
"OUTER_SET" @function.builtin
"OUTER_SPRINT" @function.builtin
"OUTER_SPRINTF" @function.builtin
"OUTER_TEXT_SPRINT" @function.builtin
"OUTER_PATCH" @function.builtin
"OUTER_PATCH_SAVE" @function.builtin
"OUTER_INNER_PATCH" @function.builtin
"OUTER_INNER_PATCH_SAVE" @function.builtin
"PRINT" @function.builtin
"LOG" @function.builtin
"WARN" @function.builtin
"FAIL" @function.builtin
"RANDOM_SEED" @function.builtin
"CLEAR_MEMORY" @function.builtin
"GET_RESOURCE_ARRAY" @function.builtin
"ACTION_GET_STRREF" @function.builtin
"ACTION_READLN" @function.builtin
"ALWAYS" @function.builtin

; Action control flow
"ACTION_IF" @keyword.conditional
"ACTION_BASH_FOR" @keyword.repeat
"ACTION_FOR_EACH" @keyword.repeat
"ACTION_PHP_EACH" @keyword.repeat
"OUTER_FOR" @keyword.repeat
"OUTER_WHILE" @keyword.repeat
"ACTION_MATCH" @keyword.conditional
"ACTION_TRY" @keyword

; Action array/variable operations
"ACTION_DEFINE_ARRAY" @function.builtin
"ACTION_DEFINE_ASSOCIATIVE_ARRAY" @function.builtin
"ACTION_CLEAR_ARRAY" @function.builtin
"ACTION_TO_LOWER" @function.builtin
"ACTION_TO_UPPER" @function.builtin

; AT_* event hooks
"AT_EXIT" @function.builtin
"AT_UNINSTALL" @function.builtin
"AT_UNINSTALL_EXIT" @function.builtin
"AT_NOW" @function.builtin
"AT_INTERACTIVE_EXIT" @function.builtin
"AT_INTERACTIVE_NOW" @function.builtin
"AT_INTERACTIVE_UNINSTALL" @function.builtin
"AT_INTERACTIVE_UNINSTALL_EXIT" @function.builtin

; ----- Patches (in-file modification commands) -----
; TextMate: entity.name.function.weidu-tp2.patch -> @function

; Read patches
"READ_BYTE" @function
"READ_SBYTE" @function
"READ_SHORT" @function
"READ_SSHORT" @function
"READ_LONG" @function
"READ_SLONG" @function
"READ_ASCII" @function
"READ_STRREF" @function
"READ_STRREF_S" @function
"READ_STRREF_F" @function
"READ_STRREF_FS" @function

; Write patches
"WRITE_BYTE" @function
"WRITE_SHORT" @function
"WRITE_LONG" @function
"WRITE_ASCII" @function
"WRITE_ASCIIE" @function
"WRITE_ASCIIL" @function
"WRITE_ASCIIT" @function
"WRITE_ASCII_TERMINATE" @function
"WRITE_ASCII_LIST" @function
"WRITE_EVALUATED_ASCII" @function

; Binary patches
"INSERT_BYTES" @function
"DELETE_BYTES" @function

; String/text patches
"REPLACE_TEXTUALLY" @function
"REPLACE" @function
"REPLACE_EVALUATE" @function
"REPLACE_BCS_BLOCK" @function
"SPRINT" @function
"SPRINTF" @function
"TEXT_SPRINT" @function
"SNPRINT" @function
"LOCAL_SPRINT" @function
"SAY" @function
"SAY_EVALUATED" @function

; Set/assignment patches
"SET" @function
"LOCAL_SET" @function

; 2DA patches
"READ_2DA_ENTRY" @function
"READ_2DA_ENTRY_FORMER" @function
"READ_2DA_ENTRIES_NOW" @function
"SET_2DA_ENTRY" @function
"SET_2DA_ENTRY_LATER" @function
"SET_2DA_ENTRIES_NOW" @function
"COUNT_2DA_COLS" @function
"COUNT_2DA_ROWS" @function
"REMOVE_2DA_ROW" @function
"INSERT_2DA_ROW" @function
(patch_pretty_print_2da) @function
"SORT_ARRAY_INDICES" @function
"APPEND_FILE" @function

; Item/spell/creature patches
"ADD_CRE_ITEM" @function
"REMOVE_CRE_ITEM" @function
"REPLACE_CRE_ITEM" @function
"ADD_KNOWN_SPELL" @function
"REMOVE_KNOWN_SPELL" @function
"ADD_MEMORIZED_SPELL" @function
"REMOVE_MEMORIZED_SPELL" @function
"ADD_STORE_ITEM" @function
"REMOVE_STORE_ITEM" @function
"ADD_MAP_NOTE" @function
"SET_BG2_PROFICIENCY" @function
(patch_remove_cre_effects) @function

; Decompile/compile patches
"DECOMPILE_AND_PATCH" @function
(patch_compile_baf_to_bcs) @function
(patch_compile_d_to_dlg) @function
(patch_decompile_bcs_to_baf) @function
(patch_decompile_dlg_to_d) @function

; Misc patches
"PATCH_INCLUDE" @function
"COUNT_REGEXP_INSTANCES" @function
"GET_OFFSET_ARRAY" @function
"GET_OFFSET_ARRAY2" @function
"GET_STRREF" @function
"GET_STRREF_S" @function
"LOOKUP_IDS_SYMBOL_OF_INT" @function
"COMPRESS_REPLACE_FILE" @function
"DECOMPRESS_REPLACE_FILE" @function
"DECOMPRESS_INTO_VAR" @function
"EVALUATE_BUFFER" @function
"SOURCE_BIFF" @function
"SPACES" @function
"QUOTE" @function
"PATCH_PRINT" @function
"PATCH_LOG" @function
"PATCH_WARN" @function
"PATCH_FAIL" @function
"PATCH_ABORT" @function
"TO_LOWER" @function
"TO_UPPER" @function
"DEFINE_ARRAY" @function
"DEFINE_ASSOCIATIVE_ARRAY" @function
"CLEAR_ARRAY" @function
(patch_reraise) @function

; Patch control flow
"PATCH_IF" @keyword.conditional
"PATCH_FOR_EACH" @keyword.repeat
"PATCH_PHP_EACH" @keyword.repeat
"FOR" @keyword.repeat
"WHILE" @keyword.repeat
"PATCH_MATCH" @keyword.conditional
"PATCH_TRY" @keyword
"PATCH_WITH_SCOPE" @keyword

; ----- Function / macro definitions -----

"DEFINE_ACTION_FUNCTION" @keyword.function
"DEFINE_PATCH_FUNCTION" @keyword.function
"DEFINE_ACTION_MACRO" @keyword.function
"DEFINE_PATCH_MACRO" @keyword.function

; Function/macro names in definitions
(action_define_function name: (identifier) @function)
(action_define_function name: (string) @function)
(action_define_patch_function name: (identifier) @function)
(action_define_patch_function name: (string) @function)
(action_define_macro name: (identifier) @function.macro)
(action_define_macro name: (string) @function.macro)
(action_define_patch_macro name: (identifier) @function.macro)
(action_define_patch_macro name: (string) @function.macro)

; ----- Function / macro invocations -----

"LAUNCH_ACTION_FUNCTION" @keyword
"LAF" @keyword
"LAUNCH_PATCH_FUNCTION" @keyword
"LPF" @keyword
"LAUNCH_ACTION_MACRO" @keyword
"LAM" @keyword
"LAUNCH_PATCH_MACRO" @keyword
"LPM" @keyword

; Function/macro names in invocations
(action_launch_function name: (identifier) @function.call)
(action_launch_function name: (string) @function.call)
(action_launch_macro name: (identifier) @function.macro)
(action_launch_macro name: (string) @function.macro)
(patch_launch_function name: (identifier) @function.call)
(patch_launch_function name: (string) @function.call)
(patch_launch_macro name: (identifier) @function.macro)
(patch_launch_macro name: (string) @function.macro)

; ----- Function parameter declarations -----

"INT_VAR" @type
"STR_VAR" @type
"RET" @type
"RET_ARRAY" @type

; ----- Control flow keywords -----

"IF" @keyword.conditional
"THEN" @keyword.conditional
"ELSE" @keyword.conditional
"END" @keyword
"BEGIN" @keyword
"UNLESS" @keyword.conditional
"WHEN" @keyword.conditional
"DEFAULT" @keyword
"WITH" @keyword
"IN" @keyword
"FROM" @keyword
"AT" @keyword

; ----- Flags (component/copy) -----

"DESIGNATED" @keyword.modifier
"DEPRECATED" @keyword.modifier
"LABEL" @keyword.modifier
"GROUP" @keyword.modifier
"FORBID_COMPONENT" @keyword.modifier
"REQUIRE_COMPONENT" @keyword.modifier
"REQUIRE_PREDICATE" @keyword.modifier
"REQUIRE_FILE" @keyword.modifier
"FORBID_FILE" @keyword.modifier
"MANAGED" @keyword.modifier
"TITLE" @keyword.modifier
"BUT_ONLY" @keyword.modifier
"BUT_ONLY_IF_IT_CHANGES" @keyword.modifier
"IF_EXISTS" @keyword.modifier
"IF_SIZE_IS" @keyword.modifier
"ON_MISMATCH" @keyword.modifier
"ALLOW_MISSING" @keyword.modifier
"DEST_DIRECTORY" @keyword.modifier
"DEST_FILE" @keyword.modifier
"DEST_FILESPEC" @keyword.modifier
"DEST_EXT" @keyword.modifier
"DEST_RES" @keyword.modifier
"KEEP_CRLF" @keyword.modifier
"NOGLOB" @keyword.modifier
"GLOB" @keyword.modifier
"CASE_SENSITIVE" @keyword.modifier
"CASE_INSENSITIVE" @keyword.modifier
"EXACT" @keyword.modifier
"EXACT_MATCH" @keyword.modifier
"EVALUATE_REGEXP" @keyword.modifier
"USING" @keyword.modifier

; ----- Expressions (built-in value expressions) -----

; Nullary expressions (no arguments, act like built-in variables)
(nullary_expr) @variable.builtin

; Memory access expressions
"BYTE_AT" @function.builtin
"SHORT_AT" @function.builtin
"LONG_AT" @function.builtin
"SBYTE_AT" @function.builtin
"SSHORT_AT" @function.builtin
"SLONG_AT" @function.builtin

; Check/query expressions
"FILE_EXISTS" @function.builtin
"FILE_EXISTS_IN_GAME" @function.builtin
"FILE_CONTAINS" @function.builtin
"FILE_CONTAINS_EVALUATED" @function.builtin
"FILE_IS_IN_COMPRESSED_BIFF" @function.builtin
"FILE_SIZE" @function.builtin
"FILE_MD5" @function.builtin
"DIRECTORY_EXISTS" @function.builtin
"GAME_IS" @function.builtin
"GAME_INCLUDES" @function.builtin
"ENGINE_IS" @function.builtin
"IS_AN_INT" @function.builtin
"VARIABLE_IS_SET" @function.builtin
"VARIABLE_IS_IN_ARRAY" @function.builtin
"MOD_IS_INSTALLED" @function.builtin
"STATE_WHICH_SAYS" @function.builtin
"TRA_ENTRY_EXISTS" @function.builtin
"ID_OF_LABEL" @function.builtin
"IDS_OF_SYMBOL" @function.builtin
"DEFINED_AS_FUNCTION" @function.builtin
"DEFINED_AS_INLINED" @function.builtin
"RESOLVE_STR_REF" @function.builtin
"STRING_LENGTH" @function.builtin
"INDEX" @function.builtin
"RINDEX" @function.builtin
"INDEX_BUFFER" @function.builtin
"RINDEX_BUFFER" @function.builtin
"RANDOM" @function.builtin
"NEXT_STRREF" @function.builtin
"EVAL" @function.builtin

; String comparison expressions
"STRING_COMPARE" @function.builtin
"STRING_COMPARE_CASE" @function.builtin
"STRING_COMPARE_REGEXP" @function.builtin
"STRING_CONTAINS_REGEXP" @function.builtin
"STRING_EQUAL" @function.builtin
"STRING_EQUAL_CASE" @function.builtin
"STRING_MATCHES_REGEXP" @function.builtin
"STR_CMP" @function.builtin
"STR_EQ" @function.builtin
"R_B_B" @function.builtin

; ----- Logical operators -----

"AND" @keyword.operator
"OR" @keyword.operator
"NOT" @keyword.operator
"BAND" @keyword.operator
"BOR" @keyword.operator
"BNOT" @keyword.operator
"BXOR" @keyword.operator
"BLSL" @keyword.operator
"BLSR" @keyword.operator
"BASR" @keyword.operator
"ABS" @keyword.operator
"MODULO" @keyword.operator

; ----- Inner action/patch -----

"INNER_ACTION" @keyword
"INNER_PATCH" @keyword
"INNER_PATCH_SAVE" @keyword
"INNER_PATCH_FILE" @keyword

; ----- Inlined files -----

(inlined_filename) @string.special

; ----- Strings -----

(string) @string

; ----- Numbers -----

(number) @number

; ----- References -----

; TRA references (@123)
(tra_ref) @string.special

; AT references (e.g. @var)
(at_ref) @variable

; Variable references (%var%)
(variable_ref) @variable

; Array access ($array(key))
(array_access) @variable

; Sound references ([sound])
(sound_ref) @string.special

; Source/dest built-in variables
"SOURCE_DIRECTORY" @variable.builtin
"SOURCE_FILE" @variable.builtin
"SOURCE_FILESPEC" @variable.builtin
"SOURCE_RES" @variable.builtin
"SOURCE_EXT" @variable.builtin
"SOURCE_SIZE" @variable.builtin
"BUFFER_LENGTH" @variable.builtin

; ----- Operators -----

"=" @operator
"==" @operator
"!=" @operator
">" @operator
">=" @operator
"<" @operator
"<=" @operator
"+" @operator
"-" @operator
"*" @operator
"/" @operator
"+=" @operator
"-=" @operator
"*=" @operator
"/=" @operator
"&=" @operator
"|=" @operator
"&&=" @operator
"||=" @operator
"++" @operator
"--" @operator
"&&" @operator
"||" @operator
"&" @operator
"|" @operator
"^" @operator
"^^" @operator
"<<" @operator
">>" @operator
"!" @operator

; ----- Punctuation -----

"#" @punctuation.special
"$" @punctuation.special
"(" @punctuation.bracket
")" @punctuation.bracket
"~" @punctuation.delimiter
"\"" @punctuation.delimiter
"%" @punctuation.delimiter
"`" @punctuation.delimiter
