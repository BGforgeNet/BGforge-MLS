; Highlight queries for WeiDU BAF (Infinity Engine scripts).
; Capture names follow Neovim conventions with dot-separated fallback.
;
; TextMate scope mapping:
;   keyword.control.weidu-baf      -> @keyword
;   entity.name.function.trigger   -> @function (triggers in IF)
;   support.function.weidu-baf     -> @function.builtin (actions in THEN)
;   string.quoted                  -> @string
;   constant.numeric               -> @number
;   constant.other                 -> @constant (object refs)
;   variable.parameter             -> @variable
;   comment.*                      -> @comment

; ----- Comments -----

(comment) @comment
(line_comment) @comment

; ----- Keywords -----

"IF" @keyword
"THEN" @keyword
"END" @keyword
"RESPONSE" @keyword
"OR" @keyword

; ----- Functions -----

; Trigger function names (in IF conditions)
(condition
  call: (call_expr
    func: (identifier) @function))

; Action function names (in THEN responses)
(action
  call: (call_expr
    func: (identifier) @function.builtin))

; ----- Literals -----

(string) @string
(number) @number

; ----- References -----

; TRA references (@123) - translation string lookups
(tra_ref) @string.special

; Variable references (%varname%)
(variable_ref) @variable

; Object references ([PC], [ENEMY], [ANYONE])
(object_ref) @constant

; Point coordinates ([x.y])
(point) @number

; ----- Constants -----

; IDS constants in argument position (General(Myself,NEUTRAL) -> NEUTRAL).
; Identified by POSITION, not casing: the args: field excludes the func: slot structurally, and every other
; argument form (%vars%, [PC], [x.y], strings, numbers) is its own node type - so a bare identifier here is
; always a constant. This covers the CamelCase OBJECT.IDS entries too, which a casing rule cannot reach.
;
; The TextMate grammar (syntaxes/weidu-baf.tmLanguage.yml) identifies the same constants by CASING instead.
; That asymmetry is deliberate: TextMate has only regex and cannot ask whether an identifier is an argument.
(call_expr
  args: (identifier) @constant)

; ----- Operators -----

"!" @operator

; ----- Punctuation -----

"#" @punctuation.special
"(" @punctuation.bracket
")" @punctuation.bracket
"[" @punctuation.bracket
"]" @punctuation.bracket
"," @punctuation.delimiter
"." @punctuation.delimiter
