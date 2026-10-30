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
 * COMMENT_CLOSED / COMMENT_OPEN: block comments NEST - WeiDU recurses on an inner opener and closes only at the
 * matching closer. Nesting is not a regular language, so this cannot be an internal token. Line comments stay
 * internal - they need no state. A comment with no closer is COMMENT_OPEN, and the grammar reports the missing
 * closer; see scan_comment for where it ends.
 *
 * *_CONTENT: the text of a string, up to its closing delimiter. Comments are extras, valid between any two
 * tokens, so tree-sitter asks this scanner for one right after a string's opening delimiter too; scanning the
 * content here, first, is what keeps a block comment opener inside `~...~` and a `//` inside `"..."` text.
 * Nothing is skipped: leading whitespace is content. The same scanner shape as the TP2 grammar's.
 *
 * IMPLICIT_END: a state whose END is missing. By the time the parser meets the next state's `BEGIN`, it has
 * consumed that state's `IF ~...~ THEN` as a transition head, and recovery cannot re-read consumed tokens, so the
 * next state was lost. Where a state's END may come, a lookahead that reads a state head - `IF [WEIGHT #n]
 * ~...~ THEN BEGIN`, which no transition can begin with - yields a zero-width token that closes the open state
 * instead. It leaves no ERROR or MISSING node, so every consumer finds it through shared/parse-errors.ts.
 */

#include "tree_sitter/parser.h"

#include <stdlib.h>
#include <string.h>

enum TokenType {
    IMMEDIATE_IDENTIFIER,
    IMMEDIATE_VARIABLE_REF,
    COMMENT_CLOSED,
    COMMENT_OPEN,
    TILDE_CONTENT,
    DOUBLE_CONTENT,
    FIVE_TILDE_CONTENT,
    IMPLICIT_END,
};

/* The literal pieces keep the narrow identifier shape rather than the widened `identifier` token:
 * a piece is spliced into a resource name, where a leading digit or a dot never occurs. */
static bool is_piece_start(int32_t c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_'; }

static bool is_piece_char(int32_t c) {
    return is_piece_start(c) || (c >= '0' && c <= '9') || c == '#';
}

/* The words that begin a line where an unclosed comment ends: what opens a top-level action, IF (a state or a
 * transition), and END. A copy of the grammar's top-level rules, which C cannot read;
 * server/test/shared/comment-boundary-words.test.ts keeps the two equal. */
static const char *const BOUNDARY_WORDS[] = {
    "ADD_STATE_TRIGGER", "ADD_TRANS_ACTION", "ADD_TRANS_TRIGGER", "ALTER_TRANS", "APPEND", "APPEND_EARLY", "A_S_T",
    "A_T_T", "BEGIN", "CHAIN", "CHAIN3", "END", "EXTEND", "EXTEND_BOTTOM", "EXTEND_TOP", "IF", "INTERJECT",
    "INTERJECT_COPY_TRANS", "INTERJECT_COPY_TRANS2", "INTERJECT_COPY_TRANS3", "INTERJECT_COPY_TRANS4", "I_C_T",
    "I_C_T2", "I_C_T3", "I_C_T4", "REPLACE", "REPLACE_ACTION_TEXT", "REPLACE_ACTION_TEXT_PROCESS",
    "REPLACE_ACTION_TEXT_PROCESS_REGEXP", "REPLACE_ACTION_TEXT_REGEXP", "REPLACE_SAY", "REPLACE_STATE_TRIGGER",
    "REPLACE_TRANS_ACTION", "REPLACE_TRANS_TRIGGER", "REPLACE_TRIGGER_TEXT", "REPLACE_TRIGGER_TEXT_REGEXP", "R_A_T",
    "R_A_T_P_R", "R_S_T", "R_T_T", "SET_WEIGHT",
};

/* Longer than any boundary word, so a longer word is never one. */
#define MAX_WORD 40

typedef struct {
    /* The comment depth falls by at most `max_fall` between any two points past this token: see scan_comment. */
    bool fall_bounded;
    uint32_t max_fall;
} Scanner;

void *tree_sitter_weidu_d_external_scanner_create(void) { return calloc(1, sizeof(Scanner)); }
void tree_sitter_weidu_d_external_scanner_destroy(void *payload) { free(payload); }

/* `max_fall` when it is bounded; an empty state is no bytes. */
unsigned tree_sitter_weidu_d_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = (Scanner *)payload;
    if (!scanner->fall_bounded) return 0;
    memcpy(buffer, &scanner->max_fall, sizeof(scanner->max_fall));
    return sizeof(scanner->max_fall);
}

void tree_sitter_weidu_d_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = (Scanner *)payload;
    scanner->fall_bounded = length == sizeof(scanner->max_fall);
    scanner->max_fall = 0;
    if (scanner->fall_bounded) memcpy(&scanner->max_fall, buffer, sizeof(scanner->max_fall));
}

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

static bool is_keyword_char(int32_t c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_';
}

/* At a line start: whether the line's first word is a boundary word. What it reads is comment text either way. */
static bool scan_boundary_line(TSLexer *lexer) {
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') lexer->advance(lexer, false);
    char word[MAX_WORD];
    unsigned length = 0;
    while (is_keyword_char(lexer->lookahead)) {
        if (length + 1 >= MAX_WORD) return false;
        word[length++] = (char)lexer->lookahead;
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
 * swallow everything after the line being typed, so the text ends at the end of the line before the first line whose
 * first word is a boundary word, or at the end of the file. A closer found far below still pairs with the opener, as
 * WeiDU reads it; a file WeiDU accepts has every closer, so this never changes what it reads.
 *
 * Telling that no closer follows takes reading to the end of the input, which done once per unclosed opener would be
 * quadratic again in a file with one per state. A scan that read to the end records, in the state its token carries,
 * the most the depth falls between any two points past where the token ends. A later opener is at least that far
 * below every point it reaches, so once its own depth exceeds that fall it can never close: it stops at its boundary
 * line. The bound carries on from token to token, as it holds for any point further down. The recording token read
 * to the end of the input, so an edit anywhere below it re-reads it and records afresh.
 */
static bool scan_comment(TSLexer *lexer, Scanner *scanner) {
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

    uint32_t depth = 1;
    bool fallback = false;
    /* Past the fallback end: the highest depth so far, and the most it has fallen from such a high. */
    uint32_t peak = 0;
    uint32_t fall = 0;
    while (depth > 0) {
        bool hopeless = scanner->fall_bounded && depth > scanner->max_fall;
        if (hopeless && fallback) {
            lexer->result_symbol = COMMENT_OPEN;
            return true;
        }
        if (lexer->eof(lexer)) {
            if (!fallback) lexer->mark_end(lexer);
            scanner->fall_bounded = true;
            scanner->max_fall = fallback ? fall : 0;
            lexer->result_symbol = COMMENT_OPEN;
            return true;
        }
        if (lexer->lookahead == '\n' && !fallback) {
            lexer->mark_end(lexer);
            lexer->advance(lexer, false);
            fallback = scan_boundary_line(lexer);
            peak = depth;
        } else if (lexer->lookahead == '/') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '*') {
                lexer->advance(lexer, false);
                depth++;
                if (depth > peak) peak = depth;
            }
        } else if (lexer->lookahead == '*') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '/') {
                lexer->advance(lexer, false);
                depth--;
                if (fallback && peak - depth > fall) fall = peak - depth;
            }
        } else {
            lexer->advance(lexer, false);
        }
    }

    lexer->mark_end(lexer);
    lexer->result_symbol = COMMENT_CLOSED;
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

static bool is_space(int32_t c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; }

static bool is_word_char(int32_t c) {
    return is_piece_char(c) || c == '.' || c == '-';
}

static void skip_spaces(TSLexer *lexer) {
    while (is_space(lexer->lookahead)) lexer->advance(lexer, false);
}

/* Consume `word` and require that it ends there; false on any mismatch. */
static bool read_word(TSLexer *lexer, const char *word) {
    for (const char *p = word; *p; p++) {
        if (lexer->lookahead != *p) return false;
        lexer->advance(lexer, false);
    }
    return !is_word_char(lexer->lookahead);
}

/* A quoted string, `~...~` or `"..."`, as a state's trigger. */
static bool read_quoted(TSLexer *lexer) {
    int32_t delimiter = lexer->lookahead;
    if (delimiter != '~' && delimiter != '"') return false;
    lexer->advance(lexer, false);
    while (!lexer->eof(lexer) && lexer->lookahead != delimiter) lexer->advance(lexer, false);
    if (lexer->eof(lexer)) return false;
    lexer->advance(lexer, false);
    return true;
}

/* At the first character of a state head: the token is zero-width here and the head is only peeked at. */
static bool scan_implicit_end(TSLexer *lexer) {
    lexer->mark_end(lexer);
    if (!read_word(lexer, "IF")) return false;
    skip_spaces(lexer);
    if (lexer->lookahead == 'W') {
        if (!read_word(lexer, "WEIGHT")) return false;
        skip_spaces(lexer);
        if (lexer->lookahead != '#') return false;
        lexer->advance(lexer, false);
        if (lexer->lookahead == '-') lexer->advance(lexer, false);
        if (lexer->lookahead < '0' || lexer->lookahead > '9') return false;
        while (lexer->lookahead >= '0' && lexer->lookahead <= '9') lexer->advance(lexer, false);
        skip_spaces(lexer);
    }
    if (!read_quoted(lexer)) return false;
    skip_spaces(lexer);
    if (!read_word(lexer, "THEN")) return false;
    skip_spaces(lexer);
    if (!read_word(lexer, "BEGIN")) return false;
    lexer->result_symbol = IMPLICIT_END;
    return true;
}

bool tree_sitter_weidu_d_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = (Scanner *)payload;

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
        if (valid_symbols[IMPLICIT_END]) {
            /* Skipped whitespace is not part of any token, so a comment can still be scanned from where it ends. */
            while (is_space(lexer->lookahead)) lexer->advance(lexer, true);
            if (lexer->lookahead == 'I') return scan_implicit_end(lexer);
        }
    }

    if (valid_symbols[COMMENT_CLOSED] && valid_symbols[COMMENT_OPEN]) return scan_comment(lexer, scanner);
    return false;
}
