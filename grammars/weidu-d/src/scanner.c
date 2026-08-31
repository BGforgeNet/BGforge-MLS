/**
 * External scanner for the WeiDU D grammar.
 *
 * An interpolated name (%tutu_var%KELDDA, TAZOK%eet_var%) is a run of literal and %var% pieces that
 * must abut with no whitespace between them. Expressed internally as token.immediate,
 * each piece re-states the identifier pattern in a second "no extras skipped" lex mode, so the
 * generated DFA carries a duplicate of the identifier machine in every state a filename can reach -
 * 200 of 786 lex states, and the single ts_lex function it produces is large enough that V8's
 * optimising tier costs about a second of CPU and a gigabyte of transient heap the first time any
 * .d file is parsed in a process. Scanning the pieces here keeps them out of that DFA.
 *
 * Adjacency is the whole point, so this scanner never skips leading whitespace: tree-sitter offers
 * the external tokens before the internal lex machine runs, and returning false when the next
 * character is not a piece start lets that machine re-skip normally.
 */

#include "tree_sitter/parser.h"

enum TokenType { IMMEDIATE_IDENTIFIER, IMMEDIATE_VARIABLE_REF };

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

bool tree_sitter_weidu_d_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
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
