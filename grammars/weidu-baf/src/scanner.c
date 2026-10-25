/**
 * External scanner for the BAF grammar. It reads one thing: a block comment, which nests.
 *
 * A comment opened with slash-star holds comments of its own: every opener inside it needs its own closer, and
 * only the last closer ends the outer one. A tree-sitter regex token cannot count, so the comment is scanned
 * here and the grammar declares it as an external token.
 *
 * The scanner runs before the internal lexer in every state, comments being extras, so it declines
 * quickly: a character that does not begin `/*` returns false with nothing consumed. An unterminated
 * comment returns false too, which leaves the opener to the parser's error recovery.
 *
 * Compiled unconditionally: the grammar declares `externals`, so this file is linked into every build,
 * native and WASM alike. The code is plain C with no state - create returns NULL, nothing is allocated.
 */

#include "tree_sitter/parser.h"

enum TokenType { COMMENT };

void *tree_sitter_baf_external_scanner_create(void) { return NULL; }
void tree_sitter_baf_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_baf_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_baf_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

static bool is_ws(int32_t c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; }

bool tree_sitter_baf_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  if (!valid_symbols[COMMENT]) return false;

  /* Whitespace before the comment is skipped, not made part of the token. */
  while (is_ws(lexer->lookahead)) {
    lexer->advance(lexer, true);
  }

  if (lexer->lookahead != '/') return false;
  lexer->advance(lexer, false);
  if (lexer->lookahead != '*') return false;
  lexer->advance(lexer, false);

  /* Both delimiters are two characters, so each loop turn consumes one character and, after a star or a slash,
     looks at the next one before deciding. A character that did not complete a delimiter is read again by the
     next turn, so a star run before a closing slash, or a slash run before an opening star, still counts. */
  unsigned depth = 1;
  while (lexer->lookahead != 0) {
    int32_t c = lexer->lookahead;
    lexer->advance(lexer, false);
    if (c == '*' && lexer->lookahead == '/') {
      lexer->advance(lexer, false);
      depth--;
      if (depth == 0) {
        lexer->mark_end(lexer);
        lexer->result_symbol = COMMENT;
        return true;
      }
    } else if (c == '/' && lexer->lookahead == '*') {
      lexer->advance(lexer, false);
      depth++;
    }
  }
  return false;
}
