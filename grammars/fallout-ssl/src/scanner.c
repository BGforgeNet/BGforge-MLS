/**
 * External scanner for Fallout SSL grammar.
 *
 * Handles five tokens (KEYWORD_PARAM and KEYWORD_PARAM_REF are described beside their code below):
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

#include <stdlib.h>
#include <string.h>

enum TokenType { NEWLINE, LINE_END, TOKEN_PASTE, KEYWORD_PARAM, KEYWORD_PARAM_REF };

/*
 * KEYWORD_PARAM / KEYWORD_PARAM_REF: a macro parameter spelled like a reserved word, and its uses in the
 * macro body. The preprocessor substitutes a parameter before the compiler's lexer sees a keyword, so
 * `#define season_morning(when) ((when) + 1)` is valid. The scanner reads such a parameter (KEYWORD_PARAM),
 * remembers its exact spelling (the preprocessor is case-sensitive) until the #define ends at LINE_END, and
 * returns the same word as KEYWORD_PARAM_REF wherever the grammar lets an expression start. Any other
 * parameter is an ordinary identifier, lexed by the internal lexer.
 *
 * This list is a copy of RESERVED_WORDS in grammar.js, which the scanner cannot read;
 * server/test/fallout-ssl/scanner-reserved-words.test.ts keeps the two equal.
 */
static const char *const RESERVED_WORDS[] = {
    "and", "andalso", "begin", "break", "bwand", "bwnot", "bwor", "bwxor", "call", "callstart",
    "cancel", "cancelall", "case", "continue", "critical", "default", "detach", "div", "do", "else",
    "end", "endcritical", "exec", "exit", "export", "false", "floor", "for", "foreach", "fork",
    "if", "import", "in", "inline", "noop", "not", "or", "orelse", "procedure", "pure",
    "return", "spawn", "startcritical", "switch", "then", "true", "variable", "when", "while",
};

/* Longer than any reserved word, so a longer name is never one. */
#define MAX_WORD 32
/* The remembered parameters, NUL-separated. A define with more keyword-named parameters than fit keeps
 * the first ones; the rest stay errors, as every keyword-named parameter was before. */
#define MAX_PARAM_BYTES 128

typedef struct {
    unsigned length;
    char names[MAX_PARAM_BYTES];
} Scanner;

void *tree_sitter_ssl_external_scanner_create(void) { return calloc(1, sizeof(Scanner)); }
void tree_sitter_ssl_external_scanner_destroy(void *payload) { free(payload); }

unsigned tree_sitter_ssl_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = (Scanner *)payload;
    memcpy(buffer, scanner->names, scanner->length);
    return scanner->length;
}

void tree_sitter_ssl_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = (Scanner *)payload;
    scanner->length = length <= MAX_PARAM_BYTES ? length : 0;
    if (scanner->length > 0) memcpy(scanner->names, buffer, scanner->length);
}

static bool is_word_start(int32_t c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_'; }
static bool is_word_char(int32_t c) { return is_word_start(c) || (c >= '0' && c <= '9'); }

/* Reads a word at the lookahead into `word`; false when the word is too long to matter. */
static bool read_word(TSLexer *lexer, char *word) {
    unsigned length = 0;
    while (is_word_char(lexer->lookahead)) {
        if (length + 1 >= MAX_WORD) return false;
        word[length++] = (char)lexer->lookahead;
        lexer->advance(lexer, false);
    }
    word[length] = '\0';
    return length > 0;
}

/* Keywords fold case in the compiler's lexer, so `When` is reserved as well. */
static bool is_reserved(const char *word) {
    for (size_t i = 0; i < sizeof(RESERVED_WORDS) / sizeof(RESERVED_WORDS[0]); i++) {
        const char *keyword = RESERVED_WORDS[i];
        size_t j = 0;
        while (keyword[j] && word[j] && (word[j] | 0x20) == keyword[j]) j++;
        if (!keyword[j] && !word[j]) return true;
    }
    return false;
}

static bool is_remembered(const Scanner *scanner, const char *word) {
    for (unsigned at = 0; at < scanner->length; at += (unsigned)strlen(scanner->names + at) + 1) {
        if (strcmp(scanner->names + at, word) == 0) return true;
    }
    return false;
}

static void remember(Scanner *scanner, const char *word) {
    unsigned size = (unsigned)strlen(word) + 1;
    if (scanner->length + size > MAX_PARAM_BYTES) return;
    memcpy(scanner->names + scanner->length, word, size);
    scanner->length += size;
}

static void skip_horizontal_space(TSLexer *lexer) {
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' || lexer->lookahead == '\f' ||
           lexer->lookahead == '\v') {
        lexer->advance(lexer, true);
    }
}

bool tree_sitter_ssl_external_scanner_scan(
    void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = (Scanner *)payload;

    /* At EOF, emit LINE_END to terminate any open #define */
    if (lexer->eof(lexer) && valid_symbols[LINE_END]) {
        scanner->length = 0;
        lexer->result_symbol = LINE_END;
        lexer->mark_end(lexer);
        return true;
    }

    /* The two never share a parse state, so both valid at once means error recovery, which marks every
     * external token valid; a keyword is not read as a name there. */
    bool recovering = valid_symbols[KEYWORD_PARAM] && valid_symbols[KEYWORD_PARAM_REF];
    if (!recovering && (valid_symbols[KEYWORD_PARAM] || (valid_symbols[KEYWORD_PARAM_REF] && scanner->length > 0))) {
        skip_horizontal_space(lexer);
        if (is_word_start(lexer->lookahead)) {
            char word[MAX_WORD];
            /* Returning false leaves the word to the internal lexer, from where the scan started. */
            if (!read_word(lexer, word)) return false;
            if (valid_symbols[KEYWORD_PARAM]) {
                if (!is_reserved(word)) return false;
                remember(scanner, word);
                lexer->mark_end(lexer);
                lexer->result_symbol = KEYWORD_PARAM;
                return true;
            }
            if (!is_remembered(scanner, word)) return false;
            lexer->mark_end(lexer);
            lexer->result_symbol = KEYWORD_PARAM_REF;
            return true;
        }
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
                scanner->length = 0;
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
    if (valid_symbols[LINE_END]) {
        scanner->length = 0;
        lexer->result_symbol = LINE_END;
    } else {
        lexer->result_symbol = NEWLINE;
    }
    return true;
}
