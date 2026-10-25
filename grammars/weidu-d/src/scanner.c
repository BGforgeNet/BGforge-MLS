/**
 * External scanner for the WeiDU D grammar.
 *
 * IMMEDIATE_*: an interpolated name (%tutu_var%KELDDA, TAZOK%eet_var%) is a run of literal and %var% pieces that
 * must abut with no whitespace between them. Expressed internally as token.immediate,
 * each piece re-states the identifier pattern in a second "no extras skipped" lex mode, so the
 * generated DFA carries a duplicate of the identifier machine in every state a filename can reach -
 * 200 of 786 lex states, and the single ts_lex function it produces is large enough that V8's
 * optimising tier pays a heavy one-off cost in CPU and transient heap the first time any .d file
 * is parsed in a process. Scanning the pieces here keeps them out of that DFA.
 * Adjacency is the whole point, so the piece scan never skips leading whitespace: tree-sitter offers
 * the external tokens before the internal lex machine runs, and returning false when the next
 * character is not a piece start lets that machine re-skip normally.
 *
 * COMMENT: block comments NEST - WeiDU recurses on an inner opener and closes only at the matching
 * closer. Nesting is not a regular language, so this cannot be an internal token. Line comments stay
 * internal - they need no state.
 *
 * *_CONTENT: the text of a string, up to its closing delimiter. Comments are extras, valid between any two
 * tokens, so tree-sitter asks this scanner for one right after a string's opening delimiter too; scanning the
 * content here, first, is what keeps a block comment opener inside `~...~` and a `//` inside `"..."` text.
 * Nothing is skipped: leading whitespace is content. The same scanner shape as the TP2 grammar's.
 */

#include "tree_sitter/parser.h"

enum TokenType {
    IMMEDIATE_IDENTIFIER,
    IMMEDIATE_VARIABLE_REF,
    COMMENT,
    TILDE_CONTENT,
    DOUBLE_CONTENT,
    FIVE_TILDE_CONTENT,
};

/* The literal pieces keep the narrow identifier shape rather than the widened `identifier` token:
 * a piece is spliced into a resource name, where a leading digit or a dot never occurs. */
static bool is_piece_start(int32_t c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_'; }

static bool is_piece_char(int32_t c) {
    return is_piece_start(c) || (c >= '0' && c <= '9') || c == '#';
}

void *tree_sitter_weidu_d_external_scanner_create(void) { return NULL; }
void tree_sitter_weidu_d_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_weidu_d_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_weidu_d_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

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

static bool scan_piece(TSLexer *lexer, const bool *valid_symbols) {
    if (valid_symbols[IMMEDIATE_VARIABLE_REF] && lexer->lookahead == '%') {
        lexer->advance(lexer, false);
        if (!is_piece_start(lexer->lookahead)) return false;
        while (is_piece_char(lexer->lookahead)) lexer->advance(lexer, false);
        if (lexer->lookahead != '%') return false;
        lexer->advance(lexer, false);
        lexer->mark_end(lexer);
        lexer->result_symbol = IMMEDIATE_VARIABLE_REF;
        return true;
    }

    if (valid_symbols[IMMEDIATE_IDENTIFIER] && is_piece_start(lexer->lookahead)) {
        while (is_piece_char(lexer->lookahead)) lexer->advance(lexer, false);
        lexer->mark_end(lexer);
        lexer->result_symbol = IMMEDIATE_IDENTIFIER;
        return true;
    }

    return false;
}

bool tree_sitter_weidu_d_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    /* During error recovery every symbol is valid at once; no string is open then and no name is being
     * assembled, so only a comment is scanned. Otherwise at most one content kind is valid: the one whose
     * opener was just read. */
    bool recovering = valid_symbols[TILDE_CONTENT] && valid_symbols[DOUBLE_CONTENT] &&
                      valid_symbols[FIVE_TILDE_CONTENT];
    if (!recovering) {
        if (valid_symbols[FIVE_TILDE_CONTENT]) return scan_five_tilde_content(lexer);
        if (valid_symbols[TILDE_CONTENT]) return scan_content_until(lexer, '~', TILDE_CONTENT);
        if (valid_symbols[DOUBLE_CONTENT]) return scan_content_until(lexer, '"', DOUBLE_CONTENT);
        if (valid_symbols[IMMEDIATE_IDENTIFIER] || valid_symbols[IMMEDIATE_VARIABLE_REF]) {
            /* A piece starts right here or not at all; anything else may still be a comment. */
            if (lexer->lookahead == '%' || is_piece_start(lexer->lookahead)) return scan_piece(lexer, valid_symbols);
        }
    }

    if (valid_symbols[COMMENT]) return scan_comment(lexer);
    return false;
}
