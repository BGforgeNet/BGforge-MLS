/**
 * External scanner for WeiDU TRA grammar.
 * Handles all tilde-delimited strings: ~text~ and ~~~~~text~~~~~.
 *
 * Tree-sitter calls the external scanner before consuming extras (whitespace).
 * We skip whitespace manually, then look for ~.
 *
 * REQUIRED for the 5-tilde form ~~~~~text~~~~~, whose text may itself contain
 * single tildes (corpus case @500 = ~~~~~text with ~ tildes~~~~~). A tree-sitter
 * regex token cannot match a balanced 5-tilde delimiter with embedded tildes
 * (the grammar DSL has no lookahead), so this scanner handles both the ~text~
 * and the 5-tilde forms. Compiled only for native builds (see #ifndef
 * TREE_SITTER_WASM below).
 */

#include "tree_sitter/parser.h"

enum TokenType { TILDE_STRING };

#ifndef TREE_SITTER_WASM

void *tree_sitter_weidu_tra_external_scanner_create(void) { return NULL; }
void tree_sitter_weidu_tra_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_weidu_tra_external_scanner_serialize(void *payload,
                                                          char *buffer) {
  return 0;
}
void tree_sitter_weidu_tra_external_scanner_deserialize(void *payload,
                                                        const char *buffer,
                                                        unsigned length) {}

static bool is_ws(int32_t c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r';
}

bool tree_sitter_weidu_tra_external_scanner_scan(void *payload, TSLexer *lexer,
                                                 const bool *valid_symbols) {
  if (!valid_symbols[TILDE_STRING]) return false;

  /* Skip whitespace (marked as skip so it doesn't become part of the token) */
  while (is_ws(lexer->lookahead)) {
    lexer->advance(lexer, true);
  }

  if (lexer->lookahead != '~') return false;

  /* Consume opening ~ */
  lexer->advance(lexer, false);

  /* If next char is not ~, enter single-tilde mode: ~content~ */
  if (lexer->lookahead != '~') {
    while (lexer->lookahead != 0) {
      if (lexer->lookahead == '~') {
        lexer->advance(lexer, false);
        lexer->mark_end(lexer);
        lexer->result_symbol = TILDE_STRING;
        return true;
      }
      lexer->advance(lexer, false);
    }
    return false;
  }

  /* Next char is ~. Mark end here to support ~~ (empty string). */
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  /* We've consumed ~~ so far. */

  /* Check for 3 more tildes to reach 5 total */
  int more = 0;
  while (lexer->lookahead == '~' && more < 3) {
    more++;
    lexer->advance(lexer, false);
  }

  if (more < 3) {
    /* 2-4 tildes total. Return ~~ (empty string); mark_end is set. */
    lexer->result_symbol = TILDE_STRING;
    return true;
  }

  /* 5 tildes consumed. Enter 5-tilde mode: scan until ~~~~~ */
  int tilde_count = 0;
  while (lexer->lookahead != 0) {
    if (lexer->lookahead == '~') {
      tilde_count++;
      lexer->advance(lexer, false);
      if (tilde_count == 5) {
        lexer->mark_end(lexer);
        lexer->result_symbol = TILDE_STRING;
        return true;
      }
    } else {
      tilde_count = 0;
      lexer->advance(lexer, false);
    }
  }
  return false;
}

#endif
