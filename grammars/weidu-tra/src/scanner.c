/**
 * External scanner for the WeiDU TRA grammar.
 *
 * *_CONTENT: the text of a string, up to its closing delimiter. Comments are extras, valid between any two
 * tokens, so tree-sitter asks this scanner for one right after a string's opening delimiter too; scanning the
 * content here, first, is what keeps a comment opener inside `~...~` and a `//` inside `"..."` text.
 * Nothing is skipped: leading whitespace is content. A five-tilde string closes at the first run of five
 * tildes, so single tildes inside it are text, which no regular token can express.
 *
 * BLOCK_COMMENT_CLOSED / BLOCK_COMMENT_OPEN: the rest of a block comment after its `/*`. Block comments NEST:
 * the installer recurses on an inner opener and closes only at the matching closer, which is not a regular
 * language. A closed comment is one token that includes its closing `*` and `/`.
 *
 * Unclosed strings and comments: the installer rejects them, and a closer found far below pairs with the
 * opener exactly as it does there. Where NO closer exists, running to the end of the file would swallow every
 * entry after the one being typed, so the text instead ends at the end of the line before the first entry
 * written at the start of a line (`@N =`), or at the end of the file. The grammar then reports the missing
 * closer there. A file the installer accepts has every closer, so this never changes what it reads. The
 * five-tilde string takes no part: its closer is a run, and a run cannot be told from text before it is read.
 *
 * TRANS_REF: `@N` as an entry's value. The same `@N` followed by `=` begins the next entry and is no value.
 */

#include "tree_sitter/parser.h"

enum TokenType {
    TILDE_CONTENT,
    DOUBLE_CONTENT,
    PERCENT_CONTENT,
    FIVE_TILDE_CONTENT,
    BLOCK_COMMENT_CLOSED,
    BLOCK_COMMENT_OPEN,
    TRANS_REF,
};

void *tree_sitter_weidu_tra_external_scanner_create(void) { return NULL; }
void tree_sitter_weidu_tra_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_weidu_tra_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_weidu_tra_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

static bool is_digit(int32_t c) { return c >= '0' && c <= '9'; }

static bool is_ws(int32_t c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

/* Called with the lexer at a line start: consume `@N =` when the line begins an entry. The characters
 * consumed are ordinary text if it does not, and none of them can close a string or a comment. */
static bool scan_entry_start(TSLexer *lexer) {
    if (lexer->lookahead != '@') return false;
    lexer->advance(lexer, false);
    if (lexer->lookahead == '-') lexer->advance(lexer, false);
    if (!is_digit(lexer->lookahead)) return false;
    while (is_digit(lexer->lookahead)) lexer->advance(lexer, false);
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') lexer->advance(lexer, false);
    if (lexer->lookahead != '=') return false;
    lexer->advance(lexer, false);
    return lexer->lookahead != '=';
}

/* The text that stands in for a missing closer ends at the last mark set before the first entry start. */
typedef struct {
    bool confirmed;
} Fallback;

/* At a newline: consume it, and mark where the text may end if the line below starts an entry - before the
 * newline, or after it when no text precedes it (a token needs at least one character). `any`: text precedes. */
static void pass_newline(TSLexer *lexer, Fallback *fallback, bool any) {
    if (fallback->confirmed) {
        lexer->advance(lexer, false);
        return;
    }
    if (any) {
        lexer->mark_end(lexer);
        lexer->advance(lexer, false);
    } else {
        lexer->advance(lexer, false);
        lexer->mark_end(lexer);
    }
    if (scan_entry_start(lexer)) fallback->confirmed = true;
}

/* Content up to the closing `delimiter`. With no closer in the file, up to the fallback end. An empty
 * content is no token. */
static bool scan_content(TSLexer *lexer, int32_t delimiter, enum TokenType symbol) {
    Fallback fallback = {false};
    bool any = false;
    for (;;) {
        if (lexer->eof(lexer)) {
            if (!any) return false;
            if (!fallback.confirmed) lexer->mark_end(lexer);
            lexer->result_symbol = symbol;
            return true;
        }
        if (lexer->lookahead == delimiter) {
            if (!any) return false;
            lexer->mark_end(lexer);
            lexer->result_symbol = symbol;
            return true;
        }
        if (lexer->lookahead == '\n') {
            pass_newline(lexer, &fallback, any);
        } else {
            lexer->advance(lexer, false);
        }
        any = true;
    }
}

/* Content up to a run of five tildes; a run of one to four tildes is content. */
static bool scan_five_tilde_content(TSLexer *lexer) {
    bool any = false;
    while (!lexer->eof(lexer)) {
        if (lexer->lookahead != '~') {
            lexer->advance(lexer, false);
            any = true;
            continue;
        }
        lexer->mark_end(lexer);
        unsigned run = 0;
        while (lexer->lookahead == '~' && run < 5) {
            lexer->advance(lexer, false);
            run++;
        }
        if (run == 5) {
            /* The closer: the token ends at the mark set before it. */
            if (!any) return false;
            lexer->result_symbol = FIVE_TILDE_CONTENT;
            return true;
        }
        any = true;
    }
    if (!any) return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = FIVE_TILDE_CONTENT;
    return true;
}

/* Called just past the opening `/*`. */
static bool scan_block_comment(TSLexer *lexer) {
    Fallback fallback = {false};
    bool any = false;
    unsigned depth = 1;
    for (;;) {
        if (lexer->eof(lexer)) {
            if (!any) return false;
            if (!fallback.confirmed) lexer->mark_end(lexer);
            lexer->result_symbol = BLOCK_COMMENT_OPEN;
            return true;
        }
        int32_t c = lexer->lookahead;
        if (c == '\n') {
            pass_newline(lexer, &fallback, any);
        } else if (c == '/') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '*') {
                lexer->advance(lexer, false);
                depth++;
            }
        } else if (c == '*') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '/') {
                lexer->advance(lexer, false);
                depth--;
                if (depth == 0) {
                    lexer->mark_end(lexer);
                    lexer->result_symbol = BLOCK_COMMENT_CLOSED;
                    return true;
                }
            }
        } else {
            lexer->advance(lexer, false);
        }
        any = true;
    }
}

static bool scan_trans_ref(TSLexer *lexer) {
    while (is_ws(lexer->lookahead)) lexer->advance(lexer, true);
    if (lexer->lookahead != '@') return false;
    lexer->advance(lexer, false);
    if (lexer->lookahead == '-') lexer->advance(lexer, false);
    if (!is_digit(lexer->lookahead)) return false;
    while (is_digit(lexer->lookahead)) lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    while (is_ws(lexer->lookahead)) lexer->advance(lexer, false);
    /* `@N =` starts the next entry; `==` is not an assignment. */
    if (lexer->lookahead == '=') {
        lexer->advance(lexer, false);
        if (lexer->lookahead != '=') return false;
    }
    lexer->result_symbol = TRANS_REF;
    return true;
}

bool tree_sitter_weidu_tra_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    /* During error recovery every symbol is valid at once; no string or comment is open then. */
    if (valid_symbols[TILDE_CONTENT] && valid_symbols[DOUBLE_CONTENT] && valid_symbols[PERCENT_CONTENT] &&
        valid_symbols[FIVE_TILDE_CONTENT])
        return false;
    if (valid_symbols[FIVE_TILDE_CONTENT]) return scan_five_tilde_content(lexer);
    if (valid_symbols[TILDE_CONTENT]) return scan_content(lexer, '~', TILDE_CONTENT);
    if (valid_symbols[DOUBLE_CONTENT]) return scan_content(lexer, '"', DOUBLE_CONTENT);
    if (valid_symbols[PERCENT_CONTENT]) return scan_content(lexer, '%', PERCENT_CONTENT);
    if (valid_symbols[BLOCK_COMMENT_CLOSED] && valid_symbols[BLOCK_COMMENT_OPEN]) return scan_block_comment(lexer);
    if (valid_symbols[TRANS_REF]) return scan_trans_ref(lexer);
    return false;
}
