; Highlight queries for Fallout SSL (Star-Trek Scripting Language).
; Capture names follow Neovim conventions with dot-separated fallback.
;
; TextMate scope mapping:
;   keyword.control.fallout-ssl        -> @keyword.conditional / @keyword.repeat
;   keyword.control.core.fallout-ssl   -> @keyword / @keyword.function / @keyword.type
;   keyword.control.import.fallout-ssl -> @keyword.import
;   entity.name.function.fallout-ssl   -> @function
;   support.function.fallout-ssl       -> @function.builtin (engine functions)
;   constant.language.fallout-ssl      -> @constant.builtin
;   constant.numeric.fallout-ssl       -> @number
;   string.quoted.double.fallout-ssl   -> @string
;   variable.language.local.fallout-ssl -> @variable
;   comment.*                          -> @comment

; ----- Comments -----

(comment) @comment
(line_comment) @comment

; ----- Preprocessor -----

"#define" @keyword.directive.define
"#include" @keyword.import
"#ifdef" @keyword.directive
"#ifndef" @keyword.directive
"#endif" @keyword.directive
"#undef" @keyword.directive
"#else" @keyword.directive

(define
  name: (identifier) @constant.macro)

(include
  path: (string) @string)

; ----- Procedure definitions -----

"procedure" @keyword.function

(procedure
  name: (identifier) @function)

(procedure_forward
  name: (identifier) @function)

; ----- Function calls -----

(call_expr
  func: (identifier) @function.call)

; ----- Procedure reference (@name) -----

(proc_ref
  (identifier) @function)
"@" @punctuation.special

; ----- Declaration keywords -----

"variable" @keyword.type
"export" @keyword.type
"import" @keyword.import

; ----- Control flow -----

(if_stmt "if" @keyword.conditional)
(if_stmt "then" @keyword.conditional)
(if_stmt "else" @keyword.conditional)

(while_stmt "while" @keyword.repeat)
(while_stmt "do" @keyword.repeat)

(for_stmt "for" @keyword.repeat)

(foreach_stmt "foreach" @keyword.repeat)
(foreach_stmt "in" @keyword.repeat)

(switch_stmt "switch" @keyword.conditional)
(case_clause "case" @keyword.conditional)
(default_clause "default" @keyword.conditional)

"begin" @keyword
"end" @keyword

"return" @keyword.return
"break" @keyword.return
"continue" @keyword.return
"call" @keyword

; ----- Ternary -----

(ternary_expr "if" @keyword.conditional.ternary)
(ternary_expr "else" @keyword.conditional.ternary)

; ----- Operator keywords -----

"and" @keyword.operator
"andalso" @keyword.operator
"or" @keyword.operator
"orelse" @keyword.operator
"not" @keyword.operator
"bwnot" @keyword.operator
"bwand" @keyword.operator
"bwor" @keyword.operator
"bwxor" @keyword.operator
"div" @keyword.operator
"floor" @keyword.operator
"in" @keyword.operator

; ----- Parameters -----

(param
  name: (identifier) @variable.parameter)

; ----- Literals -----

(string) @string
(number) @number
(boolean) @constant.builtin

; ----- Operators -----

":=" @operator
"=" @operator
"+=" @operator
"-=" @operator
"*=" @operator
"/=" @operator
"==" @operator
"!=" @operator
"<" @operator
">" @operator
"<=" @operator
">=" @operator
"+" @operator
"-" @operator
"*" @operator
"/" @operator
"%" @operator
"^" @operator
"++" @operator
"--" @operator

; ----- Punctuation -----

"(" @punctuation.bracket
")" @punctuation.bracket
"[" @punctuation.bracket
"]" @punctuation.bracket
"{" @punctuation.bracket
"}" @punctuation.bracket
"," @punctuation.delimiter
";" @punctuation.delimiter
"." @punctuation.delimiter
":" @punctuation.delimiter
