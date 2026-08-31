; Highlight queries for WeiDU D (dialog) files.
; Capture names follow Neovim conventions with dot-separated fallback.
;
; TextMate scope mapping:
;   keyword.weidu-d                     -> @keyword
;   keyword.other.weidu-d              -> @keyword
;   support.function.weidu-baf.action  -> @function.builtin (D actions)
;   string.quoted.*.weidu-d            -> @string
;   constant.numeric.weidu-d           -> @number
;   variable.parameter.weidu-d         -> @variable
;   variable.parameter.weidu-tra       -> @string.special
;   comment.*                          -> @comment

; ----- Comments -----

(comment) @comment
(line_comment) @comment

; ----- D action keywords (top-level commands) -----

"APPEND" @function.builtin
"APPEND_EARLY" @function.builtin
"EXTEND_TOP" @function.builtin
"EXTEND_BOTTOM" @function.builtin
"CHAIN" @function.builtin
"INTERJECT" @function.builtin
"INTERJECT_COPY_TRANS" @function.builtin
"INTERJECT_COPY_TRANS2" @function.builtin
"INTERJECT_COPY_TRANS3" @function.builtin
"INTERJECT_COPY_TRANS4" @function.builtin
"REPLACE" @function.builtin
"REPLACE_ACTION_TEXT" @function.builtin
"REPLACE_ACTION_TEXT_REGEXP" @function.builtin
"REPLACE_ACTION_TEXT_PROCESS" @function.builtin
"REPLACE_ACTION_TEXT_PROCESS_REGEXP" @function.builtin
"R_A_T_P_R" @function.builtin
"ALTER_TRANS" @function.builtin
"REPLACE_TRANS_TRIGGER" @function.builtin
"REPLACE_TRANS_ACTION" @function.builtin
"REPLACE_TRIGGER_TEXT" @function.builtin
"REPLACE_TRIGGER_TEXT_REGEXP" @function.builtin
"REPLACE_STATE_TRIGGER" @function.builtin
"REPLACE_SAY" @function.builtin
"SET_WEIGHT" @function.builtin
"ADD_STATE_TRIGGER" @function.builtin
"ADD_TRANS_TRIGGER" @function.builtin
"ADD_TRANS_ACTION" @function.builtin

; ----- Structure keywords -----

; BEGIN/END as structure (state blocks, lists, etc.)
"BEGIN" @keyword

; Override: BEGIN in top-level actions (e.g., BEGIN ~file~) is a command, not structure.
; Later patterns take precedence in tree-sitter, so this wins over the generic "BEGIN" @keyword.
(begin_action "BEGIN" @function.builtin)

"IF" @keyword
"THEN" @keyword
"END" @keyword
"SAY" @keyword
"REPLY" @keyword
"DO" @keyword
"GOTO" @keyword
"EXTERN" @keyword
"EXIT" @keyword
"COPY_TRANS" @keyword
"COPY_TRANS_LATE" @keyword
"WEIGHT" @keyword
"JOURNAL" @keyword
"SOLVED_JOURNAL" @keyword
"UNSOLVED_JOURNAL" @keyword
"FLAGS" @keyword
"BRANCH" @keyword
"UNLESS" @keyword
"IF_FILE_EXISTS" @keyword.modifier
"SAFE" @keyword.modifier

; ----- State labels -----

(state
  label: (state_label_alnum) @label)

; ----- Strings -----

(string) @string

; ----- Numbers -----

(number) @number

; ----- References -----

; TRA references (@123) - translation string lookups
(tra_ref) @string.special

; TLK references (#123) - game string references
(tlk_ref) @number

; AT variable references
(at_var_ref) @variable

; Variable references (%varname%)
(variable_ref) @variable

; ----- Operators -----

"==" @operator
"=" @operator
"+" @operator

; ----- Punctuation -----

"#" @punctuation.special
"(" @punctuation.bracket
")" @punctuation.bracket
"~" @punctuation.delimiter
"\"" @punctuation.delimiter
