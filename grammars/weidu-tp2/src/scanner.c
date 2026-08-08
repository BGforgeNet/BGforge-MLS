/**
 * External scanner for the WeiDU TP2 grammar.
 *
 * COMMENT: block comments NEST - WeiDU recurses on an inner opener and closes only at the matching
 * closer, so commenting out a region that already contains comments works and is used in real mods.
 * Nesting is not a regular language, so this cannot be an internal token; the depth counter below is
 * the whole reason this scanner exists. Line comments stay internal - they need no state.
 */

#include "tree_sitter/parser.h"

enum TokenType { COMMENT };

void *tree_sitter_weidu_tp2_external_scanner_create(void) { return NULL; }
void tree_sitter_weidu_tp2_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_weidu_tp2_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_weidu_tp2_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

bool tree_sitter_weidu_tp2_external_scanner_scan(
    void *payload, TSLexer *lexer, const bool *valid_symbols) {

    if (!valid_symbols[COMMENT]) return false;

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
