; Highlight queries for WeiDU translation files (.tra).
; Capture names follow Neovim conventions with dot-separated fallback.
;
; TextMate scope mapping:
;   constant.language.weidu-tra    -> @number (entry number)
;   keyword.control.weidu-tra      -> @punctuation.delimiter (@, =)
;   string.quoted.weidu-tra        -> @string
;   entity.name.function.sound     -> @string.special (sound ref)
;   comment.*                      -> @comment

; ----- Comments -----

(comment) @comment
(block_comment) @comment

; ----- Entry number -----

(entry
  number: (number) @number)

; ----- Strings -----

(tilde_string) @string
(double_string) @string
(percent_string) @string

; ----- Sound references -----

(sound_ref) @string.special

; ----- Punctuation -----

"@" @punctuation.delimiter
"=" @punctuation.delimiter
