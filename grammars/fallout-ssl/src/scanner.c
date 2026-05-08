/**
 * External scanner for Fallout SSL grammar.
 *
 * Handles three tokens:
 *
 * NEWLINE / LINE_END: In normal code, newlines are whitespace (NEWLINE extra).
 * Inside #define directives, a bare newline terminates the macro body (LINE_END).
 * Tree-sitter calls the external scanner before processing extras, so the scanner
 * gets first look at newline characters and can decide their role.
 *
 * LINE_END from backslash continuation: GCC splices \<LF> pairs in preprocessor
 * directives. If the spliced line is blank (or EOF), that blank \n terminates the
 * #define just like a bare newline. The internal lex machine SKIPs through the
 * entire \<LF> sequence without invoking the scanner on the blank line that follows.
 * We intercept this by skipping leading horizontal whitespace in the scanner before
 * looking for \, so we can emit LINE_END for the \<LF><blank><LF> pattern.
 *
 * TOKEN_PASTE: The C preprocessor ## operator used inside SSL macro bodies to
 * concatenate tokens (e.g. animate_##type##_to_tile). This token is emitted ONLY
 * when LINE_END is also a valid symbol (i.e. we are inside a #define body), so ##
 * is context-sensitive: it remains an error everywhere else in SSL code.
 *
 * Note: TREE_SITTER_WASM is NOT defined by the tree-sitter build system, so this
 * scanner runs in both native and WASM builds.
 */

#include "tree_sitter/parser.h"

enum TokenType { NEWLINE, LINE_END, TOKEN_PASTE };

void *tree_sitter_ssl_external_scanner_create(void) { return NULL; }
void tree_sitter_ssl_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_ssl_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_ssl_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

bool tree_sitter_ssl_external_scanner_scan(
    void *payload, TSLexer *lexer, const bool *valid_symbols) {

    /* At EOF, emit LINE_END to terminate any open #define */
    if (lexer->eof(lexer) && valid_symbols[LINE_END]) {
        lexer->result_symbol = LINE_END;
        lexer->mark_end(lexer);
        return true;
    }

    /* TOKEN_PASTE: ## inside a macro body.
     * Only emitted when LINE_END is valid (we are inside a #define body) and
     * TOKEN_PASTE is valid (grammar expects it as part of a token_paste_identifier).
     * Uses mark_end to peek at the second # without committing if it is absent. */
    if (lexer->lookahead == '#' && valid_symbols[TOKEN_PASTE] && valid_symbols[LINE_END]) {
        lexer->advance(lexer, false);
        if (lexer->lookahead == '#') {
            lexer->advance(lexer, false);
            lexer->mark_end(lexer);
            lexer->result_symbol = TOKEN_PASTE;
            return true;
        }
        /* Only one # - not a token-paste operator.
         * mark_end was not called after advancing past the first #, so tree-sitter
         * resets the lexer to the position of the # and re-lexes it normally. */
        return false;
    }

    /* Line continuation + blank line (GCC preprocessor behavior).
     *
     * When a macro body line ends with \<LF>, GCC splices the continuation. If
     * the spliced (continued) line is blank or contains only whitespace, the blank
     * \n acts as the macro terminator, just like a bare newline would.
     *
     * The internal lex machine SKIPs the entire \<LF> sequence as a line
     * continuation extra and then fails when it hits the blank \n, because no
     * lex state handles a lone \n without a preceding real token on that line.
     * This causes error recovery to swallow the blank line and never emit LINE_END.
     *
     * Fix: when LINE_END is valid, skip any leading horizontal whitespace first,
     * then check for the \<LF><blank-line> pattern. Skipping whitespace here is
     * safe: if we return false (non-blank continuation), tree-sitter resets the
     * lexer to current_position and the internal lex machine processes the
     * whitespace normally via its SKIP transitions. */
    if (valid_symbols[LINE_END]) {
        /* Skip leading horizontal whitespace (mirrors the lex machine's SKIP). */
        while (lexer->lookahead == ' '  || lexer->lookahead == '\t' ||
               lexer->lookahead == '\f' || lexer->lookahead == '\v') {
            lexer->advance(lexer, false);
        }

        if (lexer->lookahead == '\\') {
            lexer->advance(lexer, false);          /* consume \ */
            if (lexer->lookahead == '\r') lexer->advance(lexer, false);
            if (lexer->lookahead != '\n') return false;
            lexer->advance(lexer, false);          /* consume continuation \n */
            /* Skip any horizontal whitespace on the (blank) continuation line. */
            while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                lexer->advance(lexer, false);
            }
            /* Blank line or EOF after continuation -> LINE_END terminates macro. */
            if (lexer->lookahead == '\n' || lexer->lookahead == '\r' ||
                lexer->eof(lexer)) {
                if (lexer->lookahead == '\r') lexer->advance(lexer, false);
                if (lexer->lookahead == '\n') lexer->advance(lexer, false);
                lexer->mark_end(lexer);
                lexer->result_symbol = LINE_END;
                return true;
            }
            /* Real content on the continuation line: return false so the lex
             * machine handles \<LF> as a normal line continuation via SKIP. */
            return false;
        }
    }

    /* Skip leading horizontal whitespace when NEWLINE is valid (outside #define).
     * Without this, a whitespace-only line (spaces/tabs + newline) strands the \n:
     * the scanner returns false at the first space, the internal lex machine SKIPs
     * the spaces, but then \n is never offered to the scanner and the lex fails.
     * This also fixes CRLF files: a trailing space before \r\n would similarly strand
     * the \r without this skip.
     * Skipping here is safe: if we return false below, tree-sitter resets to
     * current_position and the internal lex machine re-processes the whitespace. */
    if (valid_symbols[NEWLINE] && !valid_symbols[LINE_END]) {
        while (lexer->lookahead == ' '  || lexer->lookahead == '\t' ||
               lexer->lookahead == '\f' || lexer->lookahead == '\v') {
            lexer->advance(lexer, false);
        }
    }

    /* Only handle newline characters below */
    if (lexer->lookahead != '\n' && lexer->lookahead != '\r') {
        return false;
    }

    /* Consume the newline: \r\n, \r, or \n */
    if (lexer->lookahead == '\r') lexer->advance(lexer, false);
    if (lexer->lookahead == '\n') lexer->advance(lexer, false);
    lexer->mark_end(lexer);

    /* Inside a #define: newline is a line terminator (terminal token).
     * Elsewhere: newline is whitespace (extra token). */
    lexer->result_symbol = valid_symbols[LINE_END] ? LINE_END : NEWLINE;
    return true;
}
