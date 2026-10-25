/**
 * External scanner for the Fallout MSG grammar.
 *
 * The game's loader reads a field as every byte after a `{` up to the next `}`, skips newlines, and fails the
 * file when a field reaches the size limit or the number field is not `[+-]?digits`. Nothing outside the
 * braces means anything to it. This scanner does the same, so the grammar's errors are the loader's failures:
 *
 * NUMBER, AUDIO, TEXT: the content of the field the parser expects right after its `{`. Nothing is skipped:
 * a space inside the braces is content, so a padded number is no number. A field that is empty, unclosed, too
 * long or (for the number) malformed yields no token, and the parser reports the field.
 * LOOSE_COMMENT: a run of text outside any field, up to the next brace, without its trailing whitespace.
 * The game skips it. A `}` is never part of it: outside a field it fails the file.
 *
 * Fields are counted in characters, which are bytes in the single-byte code pages the game reads.
 */

#include "tree_sitter/parser.h"

enum TokenType { NUMBER, AUDIO, TEXT, LOOSE_COMMENT };

/* The loader fails a field on reaching this many bytes, so 1023 is the longest that loads. */
#define FIELD_LIMIT 1024

void *tree_sitter_fallout_msg_external_scanner_create(void) { return NULL; }
void tree_sitter_fallout_msg_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_fallout_msg_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_fallout_msg_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

static bool is_digit(int32_t c) { return c >= '0' && c <= '9'; }

static bool is_space(int32_t c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; }

/* The field's content up to its closing brace. `number` also checks the loader's number shape. */
static bool scan_field(TSLexer *lexer, enum TokenType symbol, bool number) {
    unsigned length = 0;
    unsigned digits = 0;
    unsigned signs = 0;
    bool valid = true;
    while (!lexer->eof(lexer) && lexer->lookahead != '}') {
        int32_t c = lexer->lookahead;
        if (c != '\n') {
            length++;
            if (length >= FIELD_LIMIT) return false;
            if (number) {
                if (is_digit(c)) {
                    digits++;
                } else if ((c == '+' || c == '-') && length == 1) {
                    signs++;
                } else {
                    valid = false;
                }
            }
        }
        lexer->advance(lexer, false);
    }
    /* A field never closed runs to the end of the file, where the parser reports the missing brace. */
    if (length == 0) return false;
    /* The loader takes a lone sign for 0 and an empty field for no number. */
    if (number && (!valid || digits + signs == 0)) return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = symbol;
    return true;
}

static bool scan_loose_comment(TSLexer *lexer) {
    /* A run starts at the first character that is not whitespace. The internal lexer does not offer the
     * scanner a second try after it skips whitespace itself, so the whitespace is skipped here. */
    while (is_space(lexer->lookahead)) lexer->advance(lexer, true);
    bool any = false;
    while (!lexer->eof(lexer) && lexer->lookahead != '{' && lexer->lookahead != '}') {
        bool space = is_space(lexer->lookahead);
        lexer->advance(lexer, false);
        if (!space) {
            lexer->mark_end(lexer);
            any = true;
        }
    }
    if (!any) return false;
    lexer->result_symbol = LOOSE_COMMENT;
    return true;
}

bool tree_sitter_fallout_msg_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    /* During error recovery every symbol is valid at once; no field is open then. */
    if (valid_symbols[NUMBER] && valid_symbols[AUDIO] && valid_symbols[TEXT]) return false;
    if (valid_symbols[NUMBER]) return scan_field(lexer, NUMBER, true);
    if (valid_symbols[AUDIO]) return scan_field(lexer, AUDIO, false);
    if (valid_symbols[TEXT]) return scan_field(lexer, TEXT, false);
    if (valid_symbols[LOOSE_COMMENT]) return scan_loose_comment(lexer);
    return false;
}
