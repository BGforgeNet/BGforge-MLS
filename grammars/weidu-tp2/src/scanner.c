/**
 * External scanner for the WeiDU TP2 grammar.
 *
 * COMMENT: block comments NEST - WeiDU recurses on an inner opener and closes only at the matching
 * closer, so commenting out a region that already contains comments works and is used in real mods.
 * Nesting is not a regular language, so this cannot be an internal token; the depth counter below is
 * the whole reason this scanner exists. Line comments stay internal - they need no state.
 *
 * *_CONTENT: the text of a string, up to its closing delimiter. Comments are extras, valid between any two
 * tokens, so tree-sitter asks this scanner for one right after a string's opening delimiter too; scanning the
 * content here, first, is what keeps a block comment opener inside `~...~` and a `//` inside `"..."` text.
 * Nothing is skipped: leading whitespace is content.
 */

#include "tree_sitter/parser.h"

enum TokenType { COMMENT, TILDE_CONTENT, DOUBLE_CONTENT, FIVE_TILDE_CONTENT, PERCENT_CONTENT };

void *tree_sitter_weidu_tp2_external_scanner_create(void) { return NULL; }
void tree_sitter_weidu_tp2_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_weidu_tp2_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_weidu_tp2_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

/* Content up to (not including) `delimiter` or end of input; an empty content is no token. */
static bool scan_content_until(TSLexer *lexer, int32_t delimiter, enum TokenType symbol) {
    bool any = false;
    while (!lexer->eof(lexer) && lexer->lookahead != delimiter) {
        lexer->advance(lexer, false);
        any = true;
    }
    if (!any) return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = symbol;
    return true;
}

/* A percent string is a variable name: its content stops at whitespace too, so an unclosed `%foo` being typed
 * cannot run on to the next `%` lines away and swallow everything between. */
static bool scan_percent_content(TSLexer *lexer) {
    bool any = false;
    while (!lexer->eof(lexer) && lexer->lookahead != '%' && lexer->lookahead != ' ' && lexer->lookahead != '\t' &&
           lexer->lookahead != '\n' && lexer->lookahead != '\r') {
        lexer->advance(lexer, false);
        any = true;
    }
    if (!any) return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = PERCENT_CONTENT;
    return true;
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

static bool scan_comment(TSLexer *lexer) {
    /* Leading whitespace is not part of the token. If no comment starts here we return false and
     * tree-sitter resets the lexer, so the internal lex machine re-skips it normally. */
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' || lexer->lookahead == '\n' ||
           lexer->lookahead == '\r' || lexer->lookahead == '\f' || lexer->lookahead == '\v') {
        lexer->advance(lexer, true);
    }

    if (lexer->lookahead != '/') return false;
    lexer->advance(lexer, false);
    if (lexer->lookahead != '*') return false;
    lexer->advance(lexer, false);

    unsigned depth = 1;
    while (depth > 0) {
        if (lexer->eof(lexer)) return false; /* unterminated: let the parser report it */
        if (lexer->lookahead == '/') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '*') {
                lexer->advance(lexer, false);
                depth++;
            }
        } else if (lexer->lookahead == '*') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '/') {
                lexer->advance(lexer, false);
                depth--;
            }
        } else {
            lexer->advance(lexer, false);
        }
    }

    lexer->mark_end(lexer);
    lexer->result_symbol = COMMENT;
    return true;
}

bool tree_sitter_weidu_tp2_external_scanner_scan(
    void *payload, TSLexer *lexer, const bool *valid_symbols) {

    /* During error recovery every symbol is valid at once; no string is open then, so only a comment
     * is scanned. Otherwise at most one content kind is valid: the one whose opener was just read. */
    bool recovering = valid_symbols[TILDE_CONTENT] && valid_symbols[DOUBLE_CONTENT] &&
                      valid_symbols[FIVE_TILDE_CONTENT] && valid_symbols[PERCENT_CONTENT];
    if (!recovering) {
        if (valid_symbols[FIVE_TILDE_CONTENT]) return scan_five_tilde_content(lexer);
        if (valid_symbols[TILDE_CONTENT]) return scan_content_until(lexer, '~', TILDE_CONTENT);
        if (valid_symbols[DOUBLE_CONTENT]) return scan_content_until(lexer, '"', DOUBLE_CONTENT);
        if (valid_symbols[PERCENT_CONTENT]) return scan_percent_content(lexer);
    }

    if (valid_symbols[COMMENT]) return scan_comment(lexer);
    return false;
}
