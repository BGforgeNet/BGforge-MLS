/**
 * External scanner for the WeiDU TP2 grammar.
 *
 * COMMENT_CLOSED / COMMENT_OPEN: block comments NEST - WeiDU recurses on an inner opener and closes only at the
 * matching closer, so commenting out a region that already contains comments works and is used in real mods.
 * Nesting is not a regular language, so this cannot be an internal token; the depth counter below is
 * the whole reason this scanner exists. Line comments stay internal - they need no state. A comment with no
 * closer is COMMENT_OPEN, and the grammar reports the missing closer; see scan_comment for where it ends.
 *
 * *_CONTENT: the text of a string, up to its closing delimiter. Comments are extras, valid between any two
 * tokens, so tree-sitter asks this scanner for one right after a string's opening delimiter too; scanning the
 * content here, first, is what keeps a block comment opener inside `~...~` and a `//` inside `"..."` text.
 * Nothing is skipped: leading whitespace is content.
 */

#include "tree_sitter/parser.h"

#include <stdlib.h>
#include <string.h>

enum TokenType {
    COMMENT_CLOSED,
    COMMENT_OPEN,
    TILDE_CONTENT,
    DOUBLE_CONTENT,
    FIVE_TILDE_CONTENT,
    PERCENT_CONTENT,
    PERCENT_CLOSE,
};

/* The words that begin a line where an unclosed comment ends: what opens a top-level item (the prologue, the
 * top-level directives, a component's BEGIN, a function or macro definition), and END. A copy of the grammar's
 * top-level rules, which C cannot read; server/test/shared/comment-boundary-words.test.ts keeps the two equal. */
static const char *const BOUNDARY_WORDS[] = {
    "ALLOW_MISSING", "ALWAYS", "ASK_EVERY_COMPONENT", "AUTHOR", "AUTO_EVAL_STRINGS", "AUTO_TRA", "BACKUP", "BEGIN",
    "DEFINE_ACTION_FUNCTION", "DEFINE_ACTION_MACRO", "DEFINE_DIMORPHIC_FUNCTION", "DEFINE_FUNCTION_ACTION",
    "DEFINE_FUNCTION_PATCH", "DEFINE_MACRO_ACTION", "DEFINE_MACRO_PATCH", "DEFINE_PATCH_FUNCTION",
    "DEFINE_PATCH_MACRO", "END", "LANGUAGE", "LOAD", "MENU_STYLE", "MODDER", "NO_IF_EVAL_BUG", "QUICK_MENU",
    "README", "SCRIPT_STYLE", "SUPPORT", "UNINSTALL_ORDER", "VERSION",
};

/* Longer than any boundary word, so a longer word is never one. */
#define MAX_WORD 40

typedef struct {
    /* The comment depth falls by at most `max_fall` between any two points past this token: see scan_comment. */
    bool fall_bounded;
    uint32_t max_fall;
    /* The token just scanned is percent content that ended at its closer: see scan_percent_content. */
    bool percent_closes;
} Scanner;

void *tree_sitter_weidu_tp2_external_scanner_create(void) { return calloc(1, sizeof(Scanner)); }
void tree_sitter_weidu_tp2_external_scanner_destroy(void *payload) { free(payload); }

/* A byte of flags, then `max_fall` when it is bounded; an empty state is no bytes. */
unsigned tree_sitter_weidu_tp2_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = (Scanner *)payload;
    if (!scanner->fall_bounded && !scanner->percent_closes) return 0;
    buffer[0] = (char)((scanner->fall_bounded ? 1 : 0) | (scanner->percent_closes ? 2 : 0));
    if (!scanner->fall_bounded) return 1;
    memcpy(buffer + 1, &scanner->max_fall, sizeof(scanner->max_fall));
    return 1 + sizeof(scanner->max_fall);
}

void tree_sitter_weidu_tp2_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = (Scanner *)payload;
    scanner->fall_bounded = length > sizeof(scanner->max_fall) && (buffer[0] & 1);
    scanner->percent_closes = length > 0 && (buffer[0] & 2);
    scanner->max_fall = 0;
    if (scanner->fall_bounded) memcpy(&scanner->max_fall, buffer + 1, sizeof(scanner->max_fall));
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

/* WeiDU reads a percent string as one token: everything up to the closing `%`, a comment opener included. The content
 * runs to the closer, past a line end only while it holds nothing but whitespace, so an unclosed `%foo` being typed
 * ends at its own line instead of pairing with a `%` lines away, and the closer is then reported missing there.
 *
 * Nothing may stand between the content and its closer, yet where the next token fails to lex tree-sitter retries
 * the position in error mode, which reads a comment as an extra; a closer abutting that comment would then complete
 * the string around it. So the closer is this scanner's token, given only right after the opener or after content
 * that ended at it (`percent_closes`, which every other token clears). The unclosed content may be empty for the same
 * reason: declining would leave the gap open for a comment on the next line. */
static bool scan_percent_content(TSLexer *lexer, Scanner *scanner) {
    bool any = false;
    /* Everything read so far is whitespace. */
    bool blank = true;
    /* The end of the opener's line is marked: where an unclosed string's content ends. */
    bool marked = false;
    while (!lexer->eof(lexer) && lexer->lookahead != '%') {
        int32_t c = lexer->lookahead;
        if (c == '\n' || c == '\r') {
            if (!marked) {
                lexer->mark_end(lexer);
                marked = true;
            }
            if (!blank) break;
        } else if (c != ' ' && c != '\t') {
            if (marked) break;
            blank = false;
        }
        lexer->advance(lexer, false);
        any = true;
    }
    if (!lexer->eof(lexer) && lexer->lookahead == '%') {
        /* `%%` is the closer, scanned before this. */
        if (!any) return false;
        lexer->mark_end(lexer);
        scanner->percent_closes = true;
    } else if (!marked) {
        lexer->mark_end(lexer);
    }
    lexer->result_symbol = PERCENT_CONTENT;
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

static bool is_word_char(int32_t c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_';
}

/* At a line start: whether the line's first word is a boundary word. What it reads is comment text either way. */
static bool scan_boundary_line(TSLexer *lexer) {
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') lexer->advance(lexer, false);
    char word[MAX_WORD];
    unsigned length = 0;
    while (is_word_char(lexer->lookahead)) {
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
 * quadratic again in a file with one per item. A scan that read to the end records, in the state its token carries,
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

bool tree_sitter_weidu_tp2_external_scanner_scan(
    void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = (Scanner *)payload;
    /* Only the token this scan returns may carry it; see scan_percent_content. */
    bool percent_closes = scanner->percent_closes;
    scanner->percent_closes = false;

    /* During error recovery every symbol is valid at once; no string is open then, so only a comment
     * is scanned. Otherwise at most one content kind is valid: the one whose opener was just read. */
    bool recovering = valid_symbols[TILDE_CONTENT] && valid_symbols[DOUBLE_CONTENT] &&
                      valid_symbols[FIVE_TILDE_CONTENT] && valid_symbols[PERCENT_CONTENT];
    if (!recovering) {
        /* Right after the opener (content is valid there) or right after content that ended at the closer. */
        bool closer_due = valid_symbols[PERCENT_CONTENT] || percent_closes;
        if (valid_symbols[PERCENT_CLOSE] && lexer->lookahead == '%' && closer_due) {
            lexer->advance(lexer, false);
            lexer->mark_end(lexer);
            lexer->result_symbol = PERCENT_CLOSE;
            return true;
        }
        if (valid_symbols[FIVE_TILDE_CONTENT]) return scan_five_tilde_content(lexer);
        if (valid_symbols[TILDE_CONTENT]) return scan_content_until(lexer, '~', TILDE_CONTENT);
        if (valid_symbols[DOUBLE_CONTENT]) return scan_content_until(lexer, '"', DOUBLE_CONTENT);
        if (valid_symbols[PERCENT_CONTENT]) return scan_percent_content(lexer, scanner);
    }

    if (valid_symbols[COMMENT_CLOSED] && valid_symbols[COMMENT_OPEN]) return scan_comment(lexer, scanner);
    return false;
}
