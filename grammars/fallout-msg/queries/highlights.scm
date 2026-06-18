; Highlight queries for Fallout message files (.msg).
; Capture names follow Neovim conventions with dot-separated fallback.
;
; TextMate scope mapping:
;   constant.other.linenum.fallout-msg    -> @number
;   entity.name.function.sound.fallout-msg -> @string.special (audio filename)
;   string.quoted.fallout-msg              -> @string (message text)
;   keyword.control.fallout-msg            -> @punctuation.bracket (braces)
;   comment.line/comment.block.fallout-msg -> @comment

; ----- Comments -----

(comment) @comment
(block_comment) @comment

; ----- Entry fields -----

(entry
  number: (number) @number)

(entry
  audio: (audio) @string.special)

(entry
  text: (text) @string)

; ----- Punctuation -----

"{" @punctuation.bracket
"}" @punctuation.bracket
