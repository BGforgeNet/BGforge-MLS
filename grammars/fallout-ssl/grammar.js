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
    conflicts: ($) => [[$.var_init]],

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
        // The final statement may be an assignment without a trailing `;` (valid: the C
        // preprocessor pastes macro bodies verbatim, so no trailing `;` is required).
        macro_body: ($) =>
            choice(repeat1($._statement), seq(repeat($._statement), alias($.macro_final_assign, $.assignment))),

        // Assignment without trailing semicolon — valid only as the final statement of a macro body.
        // The C preprocessor pastes macro bodies verbatim, so a trailing `;` is not required.
        macro_final_assign: ($) =>
            seq(
                field("left", choice($.identifier, $.token_paste_identifier, $.subscript_expr, $.member_expr)),
                choice(":=", "=", "+=", "-=", "*=", "/="),
                field("right", $._expression),
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
        procedure_forward: ($) =>
            seq(
                alias(/[Pp]rocedure/, "procedure"),
                field("name", $.identifier),
                optional(field("params", $.param_list)),
                ";",
            ),

        // Procedure definition: procedure name begin ... end
        procedure: ($) =>
            seq(
                alias(/[Pp]rocedure/, "procedure"),
                field("name", $.identifier),
                optional(field("params", $.param_list)),
                alias(/[Bb]egin/, "begin"),
                field("body", repeat($._statement)),
                alias(/[Ee]nd/, "end"),
            ),

        param_list: ($) => seq("(", optional(commaSep($.param)), ")"),

        // SSL parameter defaults are simple values only.
        // Function calls and other compound expressions are not valid here.
        param: ($) =>
            seq(
                "variable",
                field("name", $.identifier),
                optional(seq(choice("=", ":="), field("default", $.param_default))),
            ),

        param_default: ($) =>
            choice($.identifier, $.number, $.boolean, $.string, $.param_default_group, $.param_default_unary),

        param_default_group: ($) => seq("(", $.param_default, ")"),

        param_default_unary: ($) =>
            prec(
                11,
                seq(
                    field("op", choice(alias(/[Nn][Oo][Tt]/, "not"), alias(/[Bb][Nn][Oo][Tt]/, "bnot"), "-")),
                    field("expr", $.param_default),
                ),
            ),

        // Variable: variable name; or variable name := expr; or variable a = 1, b = 2;
        // Begin blocks support comma-separated var_inits per line: variable begin a = 0, b = 0; end
        variable_decl: ($) =>
            choice(
                seq(optional("import"), "variable", commaSep($.var_init), optional(";")),
                seq("variable", "begin", repeat(seq(commaSep($.var_init), ";")), "end"),
            ),

        var_init: ($) =>
            seq(
                field("name", choice($.identifier, $.token_paste_identifier)),
                optional(seq("[", field("size", $._expression), "]")), // static array: variable a[10]
                optional(seq(choice(":=", "="), field("value", $._expression))),
            ),

        // Export: export variable name := value; (with optional init and optional semicolon)
        export_decl: ($) =>
            seq(
                "export",
                "variable",
                field("name", $.identifier),
                optional(seq(choice(":=", "="), field("value", $._expression))),
                optional(";"),
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
            ),

        if_stmt: ($) =>
            prec.right(
                seq(
                    "if",
                    field("cond", $._expression),
                    "then",
                    field("then", $._stmt_or_block),
                    optional(seq("else", field("else", $._stmt_or_block))),
                ),
            ),

        while_stmt: ($) => seq("while", field("cond", $._expression), "do", field("body", $._stmt_or_block)),

        for_stmt: ($) =>
            seq(
                "for",
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
            seq("variable", field("name", $.identifier), choice(":=", "="), field("value", $._expression)),

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
                "foreach",
                choice(
                    // foreach k: v in expr body (no parens, key:value)
                    seq(
                        field("key", $.identifier),
                        ":",
                        field("value", $.identifier),
                        "in",
                        field("iter", $._expression),
                        field("body", $._stmt_or_block),
                    ),
                    // foreach var in expr body (no parens, single var)
                    seq(
                        field("var", $.identifier),
                        "in",
                        field("iter", $._expression),
                        field("body", $._stmt_or_block),
                    ),
                    // foreach (var in expr) body or foreach (k: v in expr while cond) body
                    seq(
                        "(",
                        optional("variable"),
                        field("key", $.identifier),
                        optional(seq(":", field("value", $.identifier))),
                        "in",
                        field("iter", $._expression),
                        optional(seq("while", field("while_cond", $._expression))),
                        ")",
                        field("body", $._stmt_or_block),
                    ),
                ),
            ),

        switch_stmt: ($) =>
            seq(
                "switch",
                field("value", $._expression),
                "begin",
                repeat($.case_clause),
                optional($.default_clause),
                "end",
            ),

        case_clause: ($) => seq("case", field("value", $._expression), ":", choice($.block, repeat($._statement))),

        default_clause: ($) => seq("default", ":", choice($.block, repeat($._statement))),

        return_stmt: ($) => seq("return", optional($._expression), ";"),

        break_stmt: ($) => seq("break", ";"),

        continue_stmt: ($) => seq("continue", ";"),

        // call procedure_name; or call func(args); or call proc in ticks;
        call_stmt: ($) =>
            seq(
                "call",
                choice(field("target", $.identifier), field("target", $.call_expr)),
                optional(seq("in", field("delay", $._expression))),
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

        expression_stmt: ($) => seq($._expression, optional(";")),

        _stmt_or_block: ($) => choice($._statement, $.block),

        block: ($) => seq(alias(/[Bb]egin/, "begin"), repeat($._statement), alias(/[Ee]nd/, "end")),

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
            ),

        // Ternary expression: value_if_true if condition else value_if_false
        ternary_expr: ($) =>
            prec.right(
                -1,
                seq(
                    field("true_value", $._expression),
                    "if",
                    field("cond", $._expression),
                    "else",
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

        binary_expr: ($) =>
            choice(
                ...[
                    [alias(/[Oo][Rr]/, "or"), 1],
                    [alias(/[Oo][Rr][Ee][Ll][Ss][Ee]/, "orelse"), 1], // short-circuit or
                    [alias(/[Aa][Nn][Dd]/, "and"), 2],
                    [alias(/[Aa][Nn][Dd][Aa][Ll][Ss][Oo]/, "andalso"), 2], // short-circuit and
                    [alias(/[Bb][Ww][Oo][Rr]/, "bwor"), 3],
                    [alias(/[Bb][Ww][Xx][Oo][Rr]/, "bwxor"), 4],
                    [alias(/[Bb][Ww][Aa][Nn][Dd]/, "bwand"), 5],
                    ["==", 6],
                    ["!=", 6],
                    [alias(/[Ii][Nn]/, "in"), 6], // membership test: expr in array
                    ["<", 7],
                    [">", 7],
                    ["<=", 7],
                    [">=", 7],
                    ["+", 8],
                    ["-", 8],
                    ["*", 9],
                    ["/", 9],
                    ["%", 9],
                    ["^", 10], // exponentiation
                ].map(([op, p]) =>
                    prec.left(p, seq(field("left", $._expression), field("op", op), field("right", $._expression))),
                ),
            ),

        unary_expr: ($) =>
            choice(
                prec(
                    11,
                    seq(
                        field("op", choice(alias(/[Nn][Oo][Tt]/, "not"), alias(/[Bb][Nn][Oo][Tt]/, "bnot"), "-")),
                        field("expr", $._expression),
                    ),
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
        // Not added to: subscript_expr.object, member_expr.object, macro_call_stmt —
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
        // NOTE: SSL does not formally reserve most keywords — the language spec allows identifiers
        // like `default` or `begin` as variable names. However, tree-sitter's `word` property
        // (set to `$.identifier`) causes the lexer to prefer a keyword token over the identifier
        // token whenever that keyword appears in the current lookahead set. In practice this means
        // keywords such as `default` (used in switch) are effectively reserved in most parser
        // states, because a switch statement can appear anywhere a statement is expected.
        // Semantic detection of reserved-word identifiers is handled in the formatter, not here.
        identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

        number: ($) => token(choice(/\d+\.\d+/, /\.\d+/, /\d+/, /0x[0-9a-fA-F]+/)),

        boolean: ($) => choice("true", "false"),

        string: ($) => /"([^"\\]|\\.)*"/,

        comment: ($) => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),

        line_comment: ($) => token(seq("//", /[^\n]*/)),
    },
});

/**
 * Comma-separated list
 */
function commaSep(rule) {
    return seq(rule, repeat(seq(",", rule)));
}
