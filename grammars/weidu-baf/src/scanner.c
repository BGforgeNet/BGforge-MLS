/**
 * External scanner for the BAF grammar. It reads one thing: a block comment, which nests.
 *
 * A comment opened with slash-star holds comments of its own: every opener inside it needs its own closer, and
 * only the last closer ends the outer one. A tree-sitter regex token cannot count, so the comment is scanned
 * here and the grammar declares its two forms as external tokens.
 *
 * The scanner runs before the internal lexer in every state, comments being extras, so it declines
 * quickly: a character that does not begin `/*` returns false with nothing consumed. An unterminated
 * comment is COMMENT_OPEN, and the grammar reports the missing closer.
 *
 * Compiled unconditionally: the grammar declares `externals`, so this file is linked into every build,
 * native and WASM alike. Its one bit of state is described at tree_sitter_baf_external_scanner_scan.
 */

#include "tree_sitter/parser.h"

#include <stdlib.h>
#include <string.h>

enum TokenType { COMMENT_CLOSED, COMMENT_OPEN };

typedef struct {
  /* The comment depth falls by at most `max_fall` between any two points past this token: see
     tree_sitter_baf_external_scanner_scan. */
  bool fall_bounded;
  uint32_t max_fall;
} Scanner;

void *tree_sitter_baf_external_scanner_create(void) { return calloc(1, sizeof(Scanner)); }
void tree_sitter_baf_external_scanner_destroy(void *payload) { free(payload); }

/* `max_fall` when it is bounded; an empty state is no bytes. */
unsigned tree_sitter_baf_external_scanner_serialize(void *payload, char *buffer) {
  Scanner *scanner = (Scanner *)payload;
  if (!scanner->fall_bounded) return 0;
  memcpy(buffer, &scanner->max_fall, sizeof(scanner->max_fall));
  return sizeof(scanner->max_fall);
}

void tree_sitter_baf_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  Scanner *scanner = (Scanner *)payload;
  scanner->fall_bounded = length == sizeof(scanner->max_fall);
  scanner->max_fall = 0;
  if (scanner->fall_bounded) memcpy(&scanner->max_fall, buffer, sizeof(scanner->max_fall));
}

static bool is_ws(int32_t c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; }

static bool is_word_char(int32_t c) {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_';
}

/* The keywords that give a block its shape: a line beginning with one of them ends an unclosed comment. Matched
   case-insensitively, as the grammar reads them. */
static const char *const BOUNDARY_WORDS[] = {"if", "then", "response", "end"};

/* At a line start: whether the line's first word is a boundary word. What it reads is comment text either way. */
static bool scan_boundary_line(TSLexer *lexer) {
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t') lexer->advance(lexer, false);
  /* `| 0x20` lowercases ASCII letters and maps no other word character onto one. */
  char word[sizeof("response")];
  unsigned length = 0;
  while (is_word_char(lexer->lookahead)) {
    if (length + 1 >= sizeof(word)) return false;
    word[length++] = (char)(lexer->lookahead | 0x20);
    lexer->advance(lexer, false);
  }
  word[length] = '\0';
  for (size_t i = 0; i < sizeof(BOUNDARY_WORDS) / sizeof(BOUNDARY_WORDS[0]); i++) {
    if (strcmp(word, BOUNDARY_WORDS[i]) == 0) return true;
  }
  return false;
}

/*
 * An opener with no closer is known to be unclosed only at the end of the input; it is COMMENT_OPEN, and a scanner
 * that declined there instead would re-read the same tail at each later opener. Running to the end of the file would
 * swallow every block after the one being typed, so the text ends at the end of the line before the first line whose
 * first word is a boundary word, or at the end of the file. A closer found far below still pairs with the opener;
 * a script WeiDU accepts has every closer, so this never changes what it reads.
 *
 * Telling that no closer follows takes reading to the end of the input, which done once per unclosed opener would be
 * quadratic again in a script with one per block. A scan that read to the end records, in the state its token
 * carries, the most the depth falls between any two points past where the token ends. A later opener is at least that
 * far below every point it reaches, so once its own depth exceeds that fall it can never close: it stops at its
 * boundary line. The bound carries on from token to token, as it holds for any point further down. The recording
 * token read to the end of the input, so an edit anywhere below it re-reads it and records afresh.
 */
bool tree_sitter_baf_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  Scanner *scanner = (Scanner *)payload;
  if (!valid_symbols[COMMENT_CLOSED] || !valid_symbols[COMMENT_OPEN]) return false;

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
  uint32_t depth = 1;
  bool fallback = false;
  /* Past the fallback end: the highest depth so far, and the most it has fallen from such a high. */
  uint32_t peak = 0;
  uint32_t fall = 0;
  while (lexer->lookahead != 0) {
    bool hopeless = scanner->fall_bounded && depth > scanner->max_fall;
    if (hopeless && fallback) {
      lexer->result_symbol = COMMENT_OPEN;
      return true;
    }
    int32_t c = lexer->lookahead;
    if (c == '\n' && !fallback) {
      lexer->mark_end(lexer);
      lexer->advance(lexer, false);
      fallback = scan_boundary_line(lexer);
      peak = depth;
      continue;
    }
    lexer->advance(lexer, false);
    if (c == '*' && lexer->lookahead == '/') {
      lexer->advance(lexer, false);
      depth--;
      if (fallback && peak - depth > fall) fall = peak - depth;
      if (depth == 0) {
        lexer->mark_end(lexer);
        lexer->result_symbol = COMMENT_CLOSED;
        return true;
      }
    } else if (c == '/' && lexer->lookahead == '*') {
      lexer->advance(lexer, false);
      depth++;
      if (depth > peak) peak = depth;
    }
  }
  if (!fallback) lexer->mark_end(lexer);
  scanner->fall_bounded = true;
  scanner->max_fall = fallback ? fall : 0;
  lexer->result_symbol = COMMENT_OPEN;
  return true;
}
