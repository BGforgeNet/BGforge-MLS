/**
 * @file Fallout 2 Star-Trek Scripting Language
 * @author BGforge <dev@bgforge.net>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

export default grammar({
    name: "ssl",

    externals: ($) => [
        $._newline, // Newline as whitespace (outside #define)
        $._line_end, // Newline as macro terminator (inside #define)
        $._token_paste, // ## operator, only emitted inside #define bodies (see scanner.c)
    ],

    extras: ($) => [
        /[ \t\f\v]/, // Horizontal whitespace (newlines handled by external scanner)
        $._newline,
        $.comment,
        $.line_comment,
        /\\\r?\n/, // Line continuation with backslash
    ],

    word: ($) => $.identifier,

    // Conflicts arise from ambiguous parsing situations:
    // - var_init: `variable a = 1` could be parsed with `=` as assignment or initialization
    // - var_init vs ternary_expr: at `variable a := 1 if c else 2` the `if` could continue the
    //   initialiser as a ternary or start a new statement, and telling them apart needs lookahead past
    //   the condition to `else` versus `then`. Both readings are explored and the wrong one dies.
    conflicts: ($) => [[$.var_init], [$.var_init, $.ternary_expr]],

    rules: {
        source_file: ($) => repeat($._top_level),

        _top_level: ($) =>
            choice(
                $.preprocessor,
                $.procedure_forward,
                $.procedure,
                $.variable_decl,
                $.export_decl,
                $.macro_call_stmt, // Top-level macro invocation
            ),

        // Preprocessor: #define, #include, #ifdef, #ifndef, #endif, #undef, #else, etc.
        preprocessor: ($) =>
            choice(
                $.define,
                $.include,
                $.ifdef,
                $.ifndef,
                $.endif,
                $.undef,
                $.pp_else,
                $.other_preprocessor, // catch-all for unknown directives (#elif, #pragma, etc.)
            ),

        // #define NAME value or #define NAME(params) body
        // Combined token(prec(1, ...)) so "#define" wins over other_preprocessor
        // Body is parsed as real SSL statements/expressions, terminated by LINE_END (newline).
        define: ($) =>
            seq(
                alias(token(prec(1, seq("#", "define"))), "#define"),
                field("name", $.identifier),
                optional(field("params", $.macro_params)),
                optional(field("body", $.macro_body)),
                $._line_end,
            ),

        // Macro parameters: (a, b, c) - immediately after identifier, no whitespace.
        // Uses token.immediate("(") so the opening paren must immediately follow the name
        // (no whitespace), distinguishing `#define FOO(x) body` from `#define FOO (x)`.
        // Unlike the old opaque token, params are parsed as real identifiers.
        macro_params: ($) => seq(token.immediate("("), optional(commaSep($.identifier)), ")"),

        // Macro body: parsed as real SSL statements (expressions are covered via expression_stmt).
        // Terminated by LINE_END from the external scanner (bare newline = end of #define).
        // Line continuations (\<newline>) are in extras, so multi-line macros work transparently.
        // The final statement may omit its trailing `;` (valid: the C preprocessor pastes macro
        // bodies verbatim), so the body ends in an optional unterminated tail.
        macro_body: ($) => choice(repeat1($._statement), seq(repeat($._statement), $._macro_tail)),

        // Unterminated final statement of a macro body: only statements that REQUIRE a `;` need a
        // twin here (variable_decl, export_decl, macro_call_stmt and expression_stmt already take
        // an optional one; break/continue never end a macro in the real corpus). Each twin aliases
        // to its terminated counterpart, and the two are distinguishable only at the terminator,
        // where the scanner emits `;` or LINE_END.
        _macro_tail: ($) =>
            choice(
                alias($.macro_final_assign, $.assignment),
                alias($.macro_final_return, $.return_stmt),
                alias($.macro_final_call, $.call_stmt),
                alias($.macro_final_if, $.if_stmt),
            ),

        macro_final_assign: ($) =>
            seq(
                field("left", choice($.identifier, $.token_paste_identifier, $.subscript_expr, $.member_expr)),
                choice(":=", "=", "+=", "-=", "*=", "/="),
                field("right", $._expression),
            ),

        macro_final_return: ($) => seq(kw("return"), optional($._expression)),

        macro_final_call: ($) =>
            seq(
                // SSL keywords are case-insensitive; real scripts write `Call Foo;`. Matched as a plain
                // literal it lexes as an identifier and the statement silently becomes two expression
                // statements rather than a call.
                kw("call"),
                choice(field("target", $.identifier), field("target", $.call_expr)),
                optional(seq(kw("in"), field("delay", $._expression))),
            ),

        // An if/else whose taken branch is itself unterminated: `#define m if (c) then x := 0`.
        // The tail recurses through `else`, so an if/else-if chain ending in a bare assignment
        // parses - the shape most real macros take.
        macro_final_if: ($) =>
            prec.right(
                seq(
                    kw("if"),
                    field("cond", $._expression),
                    kw("then"),
                    choice(
                        field("then", $._macro_tail),
                        seq(field("then", $._stmt_or_block), kw("else"), field("else", $._macro_tail)),
                    ),
                ),
            ),

        // #include "file" or #include <file>
        // Combined token(prec(1, ...)) so "#include" wins over other_preprocessor
        include: ($) =>
            seq(
                alias(token(prec(1, seq("#", "include"))), "#include"),
                field(
                    "path",
                    choice(
                        $.string,
                        alias(token(seq("<", /[^>]+/, ">")), $.string),
                        $.identifier, // bare macro: #include EXTRA_HEADER (macro expands to a path)
                    ),
                ),
            ),

        // Named preprocessor directives with structured fields
        // Each uses token(prec(1, ...)) to beat the catch-all other_preprocessor (prec 0)
        ifdef: ($) => seq(alias(token(prec(1, seq("#", "ifdef"))), "#ifdef"), field("name", $.identifier)),
        ifndef: ($) => seq(alias(token(prec(1, seq("#", "ifndef"))), "#ifndef"), field("name", $.identifier)),
        endif: ($) => seq(alias(token(prec(1, seq("#", "endif"))), "#endif")),
        undef: ($) => seq(alias(token(prec(1, seq("#", "undef"))), "#undef"), field("name", $.identifier)),
        pp_else: ($) => seq(alias(token(prec(1, seq("#", "else"))), "#else")),

        // Catch-all for unknown preprocessor directives (#elif, #pragma, etc.)
        // Default precedence (0) -- named rules at prec 1 win for known directives
        other_preprocessor: ($) =>
            token(
                seq(
                    "#",
                    /[a-zA-Z_][a-zA-Z0-9_]*/, // directive name
                    // rest of line (with line continuations)
                    repeat(
                        choice(
                            /[^\n\\\/]+/, // regular chars
                            /\\./, // escaped char
                            /\\\r?\n/, // line continuation
                            /\/\*[^*]*\*+([^/*][^*]*\*+)*\//, // multi-line comment
                            /\/\/[^\n]*/, // line comment
                            /\/[^*\/\n]/, // single slash
                        ),
                    ),
                ),
            ),

        // Forward declaration: procedure name; or procedure name(params);
        // `pure` and `inline` are procedure modifiers. Without them the modifier lexes as a bare
        // identifier and becomes a top-level macro call sitting beside the procedure - a silent
        // misparse, not an error. Only `pure` occurs in the corpus (once, in a widely-included header,
        // so it reaches 55 scripts); `inline` is its counterpart in the language's keyword set.
        procedure_modifier: ($) => choice(kw("pure"), kw("inline")),

        // `critical` is a separate field because it combines with the other two rather than replacing
        // them, and only in this order: `critical pure` is accepted, `pure critical` is not.
        procedure_critical: ($) => kw("critical"),

        procedure_forward: ($) =>
            seq(
                optional(field("critical", $.procedure_critical)),
                optional(field("modifier", $.procedure_modifier)),
                kw("procedure"),
                field("name", $.identifier),
                optional(field("params", $.param_list)),
                ";",
            ),

        // Procedure definition: procedure name begin ... end
        //
        // `in <constant>` schedules the procedure to fire at that time; `when <expr>` guards it with a
        // condition the engine re-evaluates. They are mutually exclusive and belong to the definition
        // only - a forward declaration carrying either is a syntax error.
        procedure: ($) =>
            seq(
                optional(field("critical", $.procedure_critical)),
                optional(field("modifier", $.procedure_modifier)),
                kw("procedure"),
                field("name", $.identifier),
                optional(field("params", $.param_list)),
                optional(
                    choice(
                        seq(kw("in"), field("timed", $._expression)),
                        seq(kw("when"), field("condition", $._expression)),
                    ),
                ),
                kw("begin"),
                field("body", repeat($._statement)),
                kw("end"),
            ),

        // A trailing comma after the last parameter is accepted, as it is in shipped scripts.
        param_list: ($) => seq("(", optional(seq(commaSep($.param), optional(","))), ")"),

        // SSL parameter defaults are simple values only.
        // Function calls and other compound expressions are not valid here.
        param: ($) =>
            seq(
                kw("variable"),
                field("name", $.identifier),
                optional(seq(choice("=", ":="), field("default", $.param_default))),
            ),

        param_default: ($) =>
            choice($.identifier, $.number, $.boolean, $.string, $.param_default_group, $.param_default_unary),

        param_default_group: ($) => seq("(", $.param_default, ")"),

        param_default_unary: ($) =>
            prec(11, seq(field("op", choice(kw("not"), kw("bwnot"), "-")), field("expr", $.param_default))),

        // Variable: variable name; or variable name := expr; or variable a = 1, b = 2;
        // Begin blocks support comma-separated var_inits per line: variable begin a = 0, b = 0; end
        variable_decl: ($) =>
            choice(
                // prec.right for the same greedy-semicolon reason as expression_stmt.
                //
                // Known limitation: a BARE ternary initialiser (`variable a := 1 if c else 2`) does not
                // parse; the declaration reduces at `1` and strands the `if`. Telling a ternary from a
                // following if-statement needs lookahead past the condition to `else` versus `then`,
                // and because `;` is optional the two readings are genuinely ambiguous at that point -
                // ternary_expr sits at -1 precisely so `x := 1` followed by a new `if` statement closes
                // the statement instead of being swallowed. Parenthesising works and is what the
                // affected scripts can do; see the corpus allowlist entry.
                prec.right(seq(optional("import"), kw("variable"), commaSep($.var_init), optional(";"))),
                seq(kw("variable"), kw("begin"), repeat(seq(commaSep($.var_init), ";")), "end"),
            ),

        var_init: ($) =>
            seq(
                field("name", choice($.identifier, $.token_paste_identifier)),
                optional(seq("[", field("size", $._expression), "]")), // static array: variable a[10]
                optional(seq(choice(":=", "="), field("value", $._expression))),
            ),

        // Export: export variable name := value; (with optional init and optional semicolon)
        export_decl: ($) =>
            prec.right(
                seq(
                    kw("export"),
                    kw("variable"),
                    field("name", $.identifier),
                    optional(seq(choice(":=", "="), field("value", $._expression))),
                    optional(";"),
                ),
            ),

        // Statements
        _statement: ($) =>
            choice(
                $.preprocessor,
                $.variable_decl,
                $.if_stmt,
                $.while_stmt,
                $.for_stmt,
                $.foreach_stmt,
                $.switch_stmt,
                $.return_stmt,
                $.break_stmt,
                $.continue_stmt,
                $.call_stmt,
                $.assignment,
                $.expression_stmt, // Covers function calls, macro calls, bare identifiers
                $.empty_statement,
                // A bare `begin ... end` block is a statement in its own right, not only a loop or
                // if-branch body. Macros that expand to a block rely on this; without it the `begin`
                // lexes as a bare identifier and the block's `end` closes the enclosing procedure,
                // which mis-parses silently rather than erroring.
                $.block,
            ),

        // A stray `;`, most often a second one after a block's `end`. Accepted rather than an error,
        // since it occurs in shipped scripts and carries no effect.
        empty_statement: ($) => ";",

        if_stmt: ($) =>
            prec.right(
                seq(
                    kw("if"),
                    field("cond", $._expression),
                    kw("then"),
                    field("then", $._stmt_or_block),
                    optional(seq(kw("else"), field("else", $._stmt_or_block))),
                ),
            ),

        while_stmt: ($) => seq(kw("while"), field("cond", $._expression), kw("do"), field("body", $._stmt_or_block)),

        for_stmt: ($) =>
            seq(
                kw("for"),
                "(",
                field("init", optional(choice($.for_var_decl, $.for_init_assign, $._expression))),
                ";",
                field("cond", optional($._expression)),
                ";",
                field("update", optional(choice($.for_update_assign, $._expression))),
                ")",
                field("body", $._stmt_or_block),
            ),

        // Variable declaration in for loop init: variable i = 0
        for_var_decl: ($) =>
            seq(kw("variable"), field("name", $.identifier), choice(":=", "="), field("value", $._expression)),

        // Assignment in for loop init without variable keyword: i = 0
        for_init_assign: ($) => seq(field("name", $.identifier), choice(":=", "="), field("value", $._expression)),

        // Assignment in for loop update: i += 1, i := i + 1, etc. (no trailing semicolon)
        for_update_assign: ($) =>
            seq(
                field("left", choice($.identifier, $.subscript_expr, $.member_expr)),
                choice(":=", "=", "+=", "-=", "*=", "/="),
                field("right", $._expression),
            ),

        // foreach has multiple forms:
        // - foreach var in expr body
        // - foreach k: v in expr body
        // - foreach (var in expr) body  or  foreach (k: v in expr) body
        // The parenthesized form can have optional "while condition" before closing paren.
        foreach_stmt: ($) =>
            seq(
                kw("foreach"),
                choice(
                    // foreach k: v in expr body (no parens, key:value)
                    seq(
                        field("key", $.identifier),
                        ":",
                        field("value", $.identifier),
                        kw("in"),
                        field("iter", $._expression),
                        field("body", $._stmt_or_block),
                    ),
                    // foreach var in expr body (no parens, single var)
                    seq(
                        field("var", $.identifier),
                        kw("in"),
                        field("iter", $._expression),
                        field("body", $._stmt_or_block),
                    ),
                    // foreach (var in expr) body or foreach (k: v in expr while cond) body
                    seq(
                        "(",
                        optional(kw("variable")),
                        field("key", $.identifier),
                        optional(seq(":", field("value", $.identifier))),
                        kw("in"),
                        field("iter", $._expression),
                        optional(seq(kw("while"), field("while_cond", $._expression))),
                        ")",
                        field("body", $._stmt_or_block),
                    ),
                ),
            ),

        switch_stmt: ($) =>
            seq(
                kw("switch"),
                field("value", $._expression),
                kw("begin"),
                repeat($.case_clause),
                optional($.default_clause),
                kw("end"),
            ),

        // `repeat($._statement)` already covers a single `begin ... end` body now that a block is a
        // statement; listing block separately would make every braced clause ambiguous.
        case_clause: ($) => seq(kw("case"), field("value", $._expression), ":", repeat($._statement)),

        default_clause: ($) => seq(kw("default"), ":", repeat($._statement)),

        return_stmt: ($) => seq(kw("return"), optional($._expression), ";"),

        break_stmt: ($) => seq(kw("break"), ";"),

        continue_stmt: ($) => seq(kw("continue"), ";"),

        // call procedure_name; or call func(args); or call proc in ticks;
        call_stmt: ($) =>
            seq(
                // SSL keywords are case-insensitive; real scripts write `Call Foo;`. Matched as a plain
                // literal it lexes as an identifier and the statement silently becomes two expression
                // statements rather than a call.
                kw("call"),
                choice(field("target", $.identifier), field("target", $.call_expr)),
                optional(seq(kw("in"), field("delay", $._expression))),
                ";",
            ),

        // Macro invocation at top-level (outside procedures).
        // Preprocessor macros can appear anywhere in SSL code:
        // - At top-level: handled by macro_call_stmt
        // - Inside procedures: handled by expression_stmt (via identifier or call_expr)
        // - Inside expressions: handled by identifier or call_expr
        // This rule is only needed for top-level since expression_stmt isn't in _top_level.
        macro_call_stmt: ($) =>
            prec.right(
                1, // Outranks ternary_expr, same reason as expression_stmt.
                seq(
                    choice(
                        seq(field("name", $.identifier), "(", optional(commaSep($._expression)), ")"),
                        field("name", $.identifier), // Bare macro without parens
                    ),
                    optional(";"),
                ),
            ),

        assignment: ($) =>
            seq(
                field("left", choice($.identifier, $.token_paste_identifier, $.subscript_expr, $.member_expr)),
                choice(":=", "=", "+=", "-=", "*=", "/="),
                field("right", $._expression),
                ";",
            ),

        // prec.right makes the optional `;` greedy, so a semicolon following an expression belongs to
        // it rather than starting an empty_statement.
        //
        // The 1 outranks ternary_expr, and that is a deliberate divergence from the compiler. Given
        // `f(a, b)` on one line and `if (...) then ...` on the next, the compiler continues the
        // expression as a ternary and fails for want of `else`; this grammar reads two statements.
        // The reason is that a macro invocation may omit its `;` because the expansion supplies the
        // terminator - real scripts do this (`Create_Car(HEX, ELEV)` followed by an `if`) - and a macro
        // call is syntactically indistinguishable from a function call, so the two cannot be ranked
        // apart. Erring the other way would reject valid source, which is worse for an editor grammar
        // than missing a diagnostic on invalid source; the compiler still reports it.
        expression_stmt: ($) => prec.right(1, seq($._expression, optional(";"))),

        // Kept as a named alias for readability at loop and if-branch bodies; `block` reaches it
        // through `_statement`, so listing it again here would make every block ambiguous.
        _stmt_or_block: ($) => $._statement,

        block: ($) => seq(kw("begin"), repeat($._statement), kw("end")),

        // Expressions
        _expression: ($) =>
            choice(
                $.ternary_expr,
                $.binary_expr,
                $.unary_expr,
                $.call_expr,
                $.subscript_expr,
                $.member_expr,
                $.paren_expr,
                $.array_expr,
                $.map_expr,
                $.proc_ref,
                $.token_paste_identifier, // ## token-pasting (macro bodies only)
                $.identifier,
                $.number,
                $.boolean,
                $.string,
                $.char,
            ),

        // Ternary expression: value_if_true if condition else value_if_false
        ternary_expr: ($) =>
            prec.right(
                seq(
                    field("true_value", $._expression),
                    kw("if"),
                    field("cond", $._expression),
                    kw("else"),
                    field("false_value", $._expression),
                ),
            ),

        // Procedure reference: @procedure_name
        proc_ref: ($) => seq("@", $.identifier),

        // Array/map subscript access: arr[index]
        subscript_expr: ($) =>
            prec(
                12,
                seq(
                    field("object", choice($.identifier, $.subscript_expr, $.member_expr)),
                    "[",
                    field("index", $._expression),
                    "]",
                ),
            ),

        // Dot notation member access: obj.field
        member_expr: ($) =>
            prec(
                12,
                seq(
                    field("object", choice($.identifier, $.subscript_expr, $.member_expr)),
                    ".",
                    field("member", $.identifier),
                ),
            ),

        // sfall array literal: [1, 2, 3]
        array_expr: ($) => seq("[", optional(commaSep($._expression)), "]"),

        // sfall map literal: {"key": value, ...}
        map_expr: ($) => seq("{", optional(commaSep($.map_entry)), "}"),

        map_entry: ($) =>
            seq(field("key", choice($.string, $.number, $.identifier)), ":", field("value", $._expression)),

        // Precedence tiers follow the language's own grouping rather than C convention: `+ - bwand bwor
        // bwxor` all bind at one level, and `* / % div ^` all bind at another. So the bitwise operators
        // bind exactly as loosely as `+`, and `^` exactly as tightly as `*`. Grouping them the C way
        // would parse `a bwand b + c` as `a bwand (b + c)` where the language reads `(a bwand b) + c`.
        binary_expr: ($) =>
            choice(
                ...[
                    // The boolean operators share ONE precedence level and associate left, so
                    // `a or b and c` is `(a or b) and c` rather than `a or (b and c)`. This is
                    // unlike C and easy to assume wrong; the language's own parser gives all four
                    // the same level, and getting it wrong silently changes which operands pair up.
                    [kw("or"), 1],
                    [kw("orelse"), 1], // short-circuit or
                    [kw("and"), 1],
                    [kw("andalso"), 1], // short-circuit and
                    ["==", 6],
                    ["!=", 6],
                    [kw("in"), 6], // membership test: expr in array
                    ["<", 7],
                    [">", 7],
                    ["<=", 7],
                    [">=", 7],
                    ["+", 8],
                    ["-", 8],
                    [kw("bwor"), 8],
                    [kw("bwxor"), 8],
                    [kw("bwand"), 8],
                    ["*", 9],
                    ["/", 9],
                    ["%", 9],
                    [kw("div"), 9], // integer division, distinct from '/'
                    ["^", 9], // exponentiation
                ].map(([op, p]) =>
                    prec.left(p, seq(field("left", $._expression), field("op", op), field("right", $._expression))),
                ),
            ),

        // SSL's prefix operators are `floor`, `not`, `bwnot` and `-`. `floor` matters beyond spelling:
        // parsed as a call it resolves to a symbol that does not exist, where it is really a built-in
        // operator. The keyword is `bwnot` - `bnot` was accepted here previously and is not an SSL token.
        unary_expr: ($) =>
            choice(
                prec(
                    11,
                    seq(field("op", choice(kw("not"), kw("bwnot"), kw("floor"), "-")), field("expr", $._expression)),
                ),
                // Pre-increment/decrement
                prec(11, seq(field("op", choice("++", "--")), field("expr", $.identifier))),
                // Post-increment/decrement
                prec(11, seq(field("expr", $.identifier), field("op", choice("++", "--")))),
            ),

        // ## token-pasting: animate_##type##_to_tile (valid inside #define bodies only;
        // the external scanner only emits _token_paste when LINE_END is also valid).
        // Added to: call_expr.func, assignment.left, macro_final_assign.left, var_init.name,
        // and _expression (covers return/expression contexts).
        // Not added to: subscript_expr.object, member_expr.object, macro_call_stmt -
        // ## in those positions does not occur in real SSL macro bodies.
        token_paste_identifier: ($) => seq($.identifier, repeat1(seq($._token_paste, $.identifier))),

        call_expr: ($) =>
            prec(
                12,
                seq(
                    field("func", choice($.identifier, $.token_paste_identifier)),
                    "(",
                    field("args", optional(commaSep($._expression))),
                    ")",
                ),
            ),

        paren_expr: ($) => seq("(", $._expression, ")"),

        // Terminals
        // NOTE: SSL does not formally reserve most keywords - the language spec allows identifiers
        // like `default` or `begin` as variable names. However, tree-sitter's `word` property
        // (set to `$.identifier`) causes the lexer to prefer a keyword token over the identifier
        // token whenever that keyword appears in the current lookahead set. In practice this means
        // keywords such as `default` (used in switch) are effectively reserved in most parser
        // states, because a switch statement can appear anywhere a statement is expected.
        // Semantic detection of reserved-word identifiers is handled in the formatter, not here.
        identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

        number: ($) => token(choice(/\d+\.\d+/, /\.\d+/, /\d+/, /0x[0-9a-fA-F]+/)),

        boolean: ($) => choice(kw("true", 1), kw("false", 1)),

        // Adjacent literals are one string: `"ab" "cd"` is `abcd`, as in C. Only whitespace may separate
        // them - a comment between two literals ends the first one and starts a fresh expression.
        string: ($) => token(seq(/"([^"\\]|\\.)*"/, repeat(seq(/[ \t\r\n\v]*/, /"([^"\\]|\\.)*"/)))),

        // A character constant is an integer: `'A'` is 65. The escapes are the string table's, plus a
        // two- or three-digit octal form; anything else is rejected while lowering, where the message
        // can name the character.
        char: ($) => token(seq("'", choice(/[^'\\]/, /\\[^'\\0]/, /\\0[0-7]{2,3}/), "'")),

        comment: ($) => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),

        line_comment: ($) => token(seq("//", /[^\n]*/)),
    },
});

/**
 * Comma-separated list
 */
/**
 * A case-insensitive keyword, aliased back to its canonical lowercase spelling.
 *
 * SSL keywords fold case - `IF`, `If` and `if` are one token, and real scripts mix them - so matching a
 * keyword as a plain literal makes it lex as an identifier instead. That is not a parse error: the
 * construct silently becomes something else (`Call Foo;` turns into two expression statements), so it
 * survives an error-based corpus check and only shows up in the tree.
 *
 * Preprocessor directives are deliberately NOT built with this. `#define` and friends are handled by
 * the C preprocessor, which is case-sensitive.
 *
 * @param {string} word - the keyword, spelled lowercase; this becomes the node's name
 * @param {number} [precedence] - lexical precedence, needed only where `identifier` is also valid at
 *   the same position. tree-sitter's keyword extraction applies to string literals, not regexes, so a
 *   case-insensitive keyword competing with `identifier` (a boolean literal in expression position)
 *   loses the tie without it.
 */
function kw(word, precedence = 0) {
    const insensitive = [...word].map((c) => `[${c}${c.toUpperCase()}]`).join("");
    return alias(token(prec(precedence, new RegExp(insensitive))), word);
}

function commaSep(rule) {
    return seq(rule, repeat(seq(",", rule)));
}
