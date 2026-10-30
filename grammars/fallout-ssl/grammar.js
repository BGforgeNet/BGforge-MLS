/**
 * @file Fallout 2 Star-Trek Scripting Language
 * @author BGforge <dev@bgforge.net>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

/**
 * The words the reference compiler reserves: its lexer returns each one as a keyword token, case-folded, never as
 * a name, so none can be a variable, procedure or parameter name in any position. Its opcode names (`random`,
 * `display_msg`) are reserved the same way but stay names here, since completion and hover resolve them as
 * symbols. Two keywords stay out: `include` is a token the grammar never uses (tree-sitter reserves only words the
 * grammar uses), and `wait` is a macro name in shipped scripts (`#define WAIT (2)`), which the preprocessor expands
 * before the compiler's lexer sees it. A #define is exempt for the same reason: its name may be any identifier (the
 * `macro` set), and so may its parameters (see _macro_param). src/scanner.c keeps a copy of this list.
 * server/test/integration/fallout-ssl-grammar-differential.test.ts checks the list against the compiler.
 */
const RESERVED_WORDS = [
    "and",
    "andalso",
    "begin",
    "break",
    "bwand",
    "bwnot",
    "bwor",
    "bwxor",
    "call",
    "callstart",
    "cancel",
    "cancelall",
    "case",
    "continue",
    "critical",
    "default",
    "detach",
    "div",
    "do",
    "else",
    "end",
    "endcritical",
    "exec",
    "exit",
    "export",
    "false",
    "floor",
    "for",
    "foreach",
    "fork",
    "if",
    "import",
    "in",
    "inline",
    "noop",
    "not",
    "or",
    "orelse",
    "procedure",
    "pure",
    "return",
    "spawn",
    "startcritical",
    "switch",
    "then",
    "true",
    "variable",
    "when",
    "while",
];

/** Keywords that compete with `identifier` where both are valid, so they need a lexical precedence (see kw()). */
const KEYWORD_PRECEDENCE = { true: 1, false: 1 };

export default grammar({
    name: "ssl",

    externals: ($) => [
        $._newline, // Newline as whitespace (outside #define)
        $._line_end, // Newline as macro terminator (inside #define)
        $._token_paste, // ## operator, only emitted inside #define bodies (see scanner.c)
        $._keyword_param, // A macro parameter spelled like a reserved word (see _macro_param)
        $._keyword_param_ref, // That parameter's use in the macro's body (see scanner.c)
        // Zero-width: a `)`, `]`, `}` or procedure `begin` the source lacks before `end` or `procedure`, so the
        // procedure being typed keeps its shape (see scanner.c). Consumers report it through shared/parse-errors.ts.
        $.implicit_end,
        // A block comment with no `*/` before the end of the input, up to the next `end` or procedure (see
        // scanner.c). No rule accepts it, so the parse reports it, and one token over the text keeps a run of
        // unclosed openers linear.
        // Not the closed/open comment pair of the BAF and TP2 grammars: here any non-terminal extra moves error
        // recovery in source that already fails to parse.
        $._unclosed_comment,
    ],

    extras: ($) => [
        /[ \t\f\v]/, // Horizontal whitespace (newlines handled by external scanner)
        $._newline,
        $.comment,
        $.line_comment,
        /\\\r?\n/, // Line continuation with backslash
    ],

    word: ($) => $.identifier,

    // The compiler's lexer turns every keyword into its token wherever it appears, so a keyword never reads as a
    // name. Without this, tree-sitter reads one as an identifier wherever the keyword itself is not expected, and
    // `foo(` typed before an `end` swallows the `end` and every procedure after it.
    reserved: {
        global: () => RESERVED_WORDS.map((word) => keywordToken(word, KEYWORD_PRECEDENCE[word] ?? 0)),
        // The preprocessor takes any identifier as a macro name.
        macro: () => [],
    },

    // Conflicts arise from ambiguous parsing situations:
    // - var_init: `variable a = 1` could be parsed with `=` as assignment or initialization
    // - var_init vs ternary_expr: at `variable a := 1 if c else 2` the `if` could continue the
    //   initialiser as a ternary or start a new statement, and telling them apart needs lookahead past
    //   the condition to `else` versus `then`. Both readings are explored and the wrong one dies.
    // - _foreach_head vs ternary_expr: same shape as var_init's - at `foreach v in a if c else b` the
    //   `if` could continue the iterable as a ternary or (with a `while` guard absent) end the head.
    conflicts: ($) => [[$.var_init], [$.var_init, $.ternary_expr], [$._foreach_head, $.ternary_expr]],

    rules: {
        source_file: ($) => repeat($._top_level),

        _top_level: ($) =>
            choice(
                $.preprocessor,
                $.procedure_forward,
                $.procedure_forward_block,
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
                field("name", reserved("macro", $.identifier)),
                optional(field("params", $.macro_params)),
                optional(field("body", $.macro_body)),
                $._line_end,
            ),

        // Macro parameters: (a, b, c) - immediately after identifier, no whitespace.
        // Uses token.immediate("(") so the opening paren must immediately follow the name
        // (no whitespace), distinguishing `#define FOO(x) body` from `#define FOO (x)`.
        // Unlike the old opaque token, params are parsed as real identifiers. A trailing `...` takes any further
        // arguments as `__VA_ARGS__`, as the sfall headers use it.
        macro_params: ($) =>
            seq(
                token.immediate("("),
                optional(choice(seq(commaSep($._macro_param), optional(seq(",", "..."))), "...")),
                ")",
            ),

        // The preprocessor takes any identifier as a parameter name and substitutes it in the body before the
        // compiler's lexer sees a keyword, so `#define season_morning(when) (... (when) ...)` compiles. The
        // reserved-word sets cannot express this: a set given to a rule reaches only the first token of that rule,
        // never a name nested inside the body's expressions. So the external scanner reads a parameter spelled like
        // a reserved word, remembers it until the end of the #define, and reads that word in the body as a name
        // wherever an expression may start; the same word stays a keyword everywhere else.
        _macro_param: ($) => choice($.identifier, alias($._keyword_param, $.identifier)),

        // Macro body: parsed as real SSL statements (expressions are covered via expression_stmt).
        // Terminated by LINE_END from the external scanner (bare newline = end of #define).
        // Line continuations (\<newline>) are in extras, so multi-line macros work transparently.
        // The final statement may omit its trailing `;` (valid: the C preprocessor pastes macro
        // bodies verbatim), so the body ends in an optional unterminated tail.
        //
        // Not supported: a body defining a whole procedure (`procedure Node##name begin ... end`, two shipped
        // scripts). It costs about a sixth more parse states, since every statement inside it needs its own
        // macro-body states; those scripts are on the known-parse-error allowlist instead.
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

        macro_final_call: ($) => callBody($),

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

        // An imported or exported procedure is declared like a forward declaration, with no modifiers; the
        // compiler refuses a body after one.
        procedure_forward: ($) =>
            seq(
                choice(
                    seq(
                        optional(field("critical", $.procedure_critical)),
                        optional(field("modifier", $.procedure_modifier)),
                    ),
                    field("linkage", $.linkage),
                ),
                kw("procedure"),
                $._procedure_declarator,
            ),

        _procedure_declarator: ($) => seq(field("name", $.identifier), optional(field("params", $.param_list)), ";"),

        linkage: ($) => choice(kw("import"), kw("export")),

        // `import procedure begin a; b(variable x); end`: several declarations under one linkage. Each one is a
        // procedure_forward, so whatever lists forward declarations finds these too.
        procedure_forward_block: ($) =>
            seq(
                field("linkage", $.linkage),
                kw("procedure"),
                kw("begin"),
                repeat(alias($._procedure_declarator, $.procedure_forward)),
                kw("end"),
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
                $._procedure_body,
            ),

        // Its own rule only to share parse states: inline, the body is repeated after every combination of the
        // optional header parts above, which costs about a twelfth of the parse states. The tree is the same.
        _procedure_body: ($) =>
            seq(choice(kw("begin"), $.implicit_end), field("body", repeat($._statement)), kw("end")),

        // A trailing comma after the last parameter is accepted, as it is in shipped scripts.
        param_list: ($) => seq("(", optional(seq(commaSep($.param), optional(","))), choice(")", $.implicit_end)),

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
                prec.right(seq(optional(kw("import")), kw("variable"), commaSep($.var_init), optional(";"))),
                seq(
                    optional(kw("import")),
                    kw("variable"),
                    kw("begin"),
                    repeat(seq(commaSep($.var_init), ";")),
                    kw("end"),
                ),
            ),

        var_init: ($) =>
            seq(
                field("name", choice($.identifier, $.token_paste_identifier)),
                // Static array: `variable a[10]`, or `variable a[10, 2]` where the second constant is the
                // array's flags. Without the flags form the comma ends the declaration and the rest
                // parses as a separate array-literal statement, which is a silent misparse, not an error.
                // The bracket run is dynamically preferred: `variable b[4, 2];` also parses as a bare
                // declaration followed by the array literal `[4, 2]` as its own statement, and without a
                // preference tree-sitter picks that reading in some states and this one in others.
                optional(
                    prec.dynamic(
                        1,
                        seq("[", field("size", $._expression), optional(seq(",", field("flags", $._expression))), "]"),
                    ),
                ),
                optional(seq(choice(":=", "="), field("value", $._expression))),
            ),

        // Export: export variable name := value; (with optional init and optional semicolon), or a block of
        // them, `export variable begin a := 1; b; end`, whose names are var_init children.
        export_decl: ($) =>
            choice(
                prec.right(
                    seq(
                        kw("export"),
                        kw("variable"),
                        field("name", $.identifier),
                        optional(seq(choice(":=", "="), field("value", $._expression))),
                        optional(";"),
                    ),
                ),
                seq(kw("export"), kw("variable"), kw("begin"), repeat(seq($.var_init, optional(";"))), kw("end")),
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
                $.process_stmt,
                $.assignment,
                $.expression_stmt, // Covers function calls, macro calls, bare identifiers
                $.empty_statement,
                $.else_clause,
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

        // The `else` of an `if ... then` that a macro expansion opened: `check_forced_dialog else begin ... end`,
        // where `check_forced_dialog` expands to `if (...) then call Node1;`. The compiler sees the expansion, so
        // the source is valid, and shipped scripts are full of it. The grammar does not expand macros, so the
        // clause stands as a statement of its own after the macro's; tying it to the macro statement instead
        // costs a GLR conflict on every statement and about a tenth more parse states. An if-branch's own `else`
        // still binds to its `if`: if_stmt is right-associative.
        else_clause: ($) => seq(kw("else"), field("else", $._stmt_or_block)),

        while_stmt: ($) => seq(kw("while"), field("cond", $._expression), kw("do"), field("body", $._stmt_or_block)),

        // The parentheses are optional. Without them the update ends in its own `;`; inside them a `;` after the
        // update is allowed as well.
        for_stmt: ($) =>
            seq(
                kw("for"),
                choice(seq("(", $._for_header, optional(";"), ")"), seq($._for_header, ";")),
                field("body", $._stmt_or_block),
            ),

        _for_header: ($) =>
            seq(
                field("init", optional(choice($.for_var_decl, $.for_init_assign, $._expression))),
                ";",
                field("cond", optional($._expression)),
                ";",
                field("update", optional(choice($.for_update_assign, $._expression))),
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
        // The parentheses are optional and change nothing inside them: `variable`, the `key: value` pair
        // and the trailing `while` guard are available with or without them.
        foreach_stmt: ($) =>
            seq(
                kw("foreach"),
                choice($._foreach_head, seq("(", $._foreach_head, ")")),
                field("body", $._stmt_or_block),
            ),

        // A lone loop variable lands in `key`; with `k: v` the second one is the value. The `while`
        // guard is ANDed into the loop's own bounds test rather than being a separate loop.
        // Right-associative so a `while` after the iterable is taken as the guard rather than as the
        // start of a while-loop body, which is the greedy reading the language's own parser takes.
        _foreach_head: ($) =>
            prec.right(
                seq(
                    optional(kw("variable")),
                    field("key", $.identifier),
                    optional(seq(":", field("value", $.identifier))),
                    kw("in"),
                    field("iter", $._expression),
                    optional(seq(kw("while"), field("while_cond", $._expression))),
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

        // Process-control statements: the engine runs child scripts, suspends, cancels pending events and
        // marks critical sections through these. All but `wait` are reserved words (see RESERVED_WORDS): a
        // shipped script does `#define WAIT (2)` and then uses that name in an expression, so reserving it
        // would turn such a file into a wall of syntax errors.
        process_stmt: ($) =>
            choice(
                seq(
                    field(
                        "op",
                        choice(
                            kw("exit"),
                            kw("detach"),
                            kw("startcritical"),
                            kw("endcritical"),
                            kw("cancelall"),
                            kw("noop"),
                        ),
                    ),
                    ";",
                ),
                seq(
                    field("op", choice(kw("spawn"), kw("callstart"), kw("exec"), kw("fork"), kw("wait"))),
                    "(",
                    field("arg", $._expression),
                    ")",
                    ";",
                ),
                // `cancel` names the procedure whose pending events are dropped, so its argument is a
                // name rather than a value.
                seq(field("op", kw("cancel")), "(", field("arg", $.identifier), ")", ";"),
            ),

        break_stmt: ($) => seq(kw("break"), ";"),

        continue_stmt: ($) => seq(kw("continue"), ";"),

        // call procedure_name; or call func(args); or call proc in ticks; or call proc when cond;
        call_stmt: ($) => seq(callBody($), ";"),

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
                alias($._keyword_param_ref, $.identifier), // macro bodies only, see _macro_param
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
        array_expr: ($) => seq("[", optional(commaSep($._expression)), choice("]", $.implicit_end)),

        // sfall map literal: {"key": value, ...}
        map_expr: ($) => seq("{", optional(commaSep($.map_entry)), choice("}", $.implicit_end)),

        // The key is a whole expression, not a literal. Most scripts spell one as a string or a bare
        // name, but a PID constant expands to `(16777313)` - so a map keyed by one arrives here
        // parenthesised, and a key list of string/number/identifier rejects source that compiles.
        map_entry: ($) => seq(field("key", $._expression), ":", field("value", $._expression)),

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
                    // There is no `in` operator: the language takes `in` only after a call target, a procedure
                    // header and a foreach variable.
                    //
                    // The compiler takes one comparison between two operands and rejects a chain (`a < b < c`),
                    // where this grammar groups one. Only source the compiler refuses can tell the two apart, so
                    // no valid tree differs; the compiler's own diagnostic still reports it.
                    ["==", 6],
                    ["!=", 6],
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
                // Post-increment/decrement only: the language has no PREFIX form, in a statement or
                // anywhere else, so `++x` is a syntax error rather than a second spelling of `x++`. An
                // array element may be stepped as well - `a[1]++` is `a[1] += 1`, down to which
                // temporaries the index needs. The target list is spelled out rather than shared with
                // `assignment`: a rule of its own adds a reduction step that collides with the
                // macro-body assignment twin.
                prec(
                    11,
                    seq(
                        field("expr", choice($.identifier, $.subscript_expr, $.member_expr)),
                        field("op", choice("++", "--")),
                    ),
                ),
            ),

        // ## token-pasting: animate_##type##_to_tile (valid inside #define bodies only;
        // the external scanner only emits _token_paste when LINE_END is also valid).
        // Added to: call_expr.func, assignment.left, macro_final_assign.left, var_init.name,
        // and _expression (covers return/expression contexts).
        // Not added to: subscript_expr.object, member_expr.object, macro_call_stmt -
        // ## in those positions does not occur in real SSL macro bodies.
        token_paste_identifier: ($) => seq($.identifier, repeat1(seq($._token_paste, $.identifier))),

        // A STRING may be the callee: `"node_" + n` is not it, but a literal `"foo"(1)` calls the
        // procedure named by the string, resolved by the engine at run time.
        //
        // So may a call, for the macro idiom that picks a callee by argument count:
        // `FUNC_SELECTOR_7(__VA_ARGS__, f7, ..., f1)(format, __VA_ARGS__)` expands to `fN(format, ...)`. The
        // compiler only ever sees the expansion, and source written that way outside a macro is refused there.
        call_expr: ($) =>
            prec(
                12,
                seq(
                    field("func", choice($.identifier, $.token_paste_identifier, $.string, $.call_expr)),
                    "(",
                    field("args", optional(commaSep($._expression))),
                    ")",
                ),
            ),

        paren_expr: ($) => seq("(", $._expression, ")"),

        // Terminals. The keywords the compiler reserves never lex as this token: see RESERVED_WORDS.
        identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

        // A float may end at its point (`5.` is 5.0), and the hex prefix takes either case, as the compiler reads both.
        number: ($) => token(choice(/\d+\.\d*/, /\.\d+/, /\d+/, /0[xX][0-9a-fA-F]+/)),

        boolean: ($) => choice(kw("true", KEYWORD_PRECEDENCE.true), kw("false", KEYWORD_PRECEDENCE.false)),

        // Adjacent literals are one string: `"ab" "cd"` is `abcd`, as in C. Only whitespace may separate
        // them - a comment between two literals ends the first one and starts a fresh expression.
        //
        // One literal ends on its own line: the compiler's preprocessor refuses a newline inside a string
        // ("Unterminated string literal"), and a backslash-newline is the only way to continue one. That also
        // keeps an unclosed `"` from pairing with the next quote lines away and swallowing the file.
        //
        // `@"..."` is a raw string: the compiler takes its backslashes literally. It still ends where an escaped
        // string would, because the preprocessor reads it as one before the compiler sees the `@`.
        string: ($) =>
            token(
                seq(
                    optional("@"),
                    /"([^"\\\n]|\\.|\\\r?\n)*"/,
                    repeat(seq(/[ \t\r\n\v]*/, /"([^"\\\n]|\\.|\\\r?\n)*"/)),
                ),
            ),

        // A character constant is an integer: `'A'` is 65. The escapes are the string table's, plus a
        // two- or three-digit octal form; anything else is rejected while lowering, where the message
        // can name the character.
        char: ($) => token(seq("'", choice(/[^'\\]/, /\\[^'\\0]/, /\\0[0-7]{2,3}/), "'")),

        // A comment never closed is _unclosed_comment, from the external scanner.
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
    return alias(keywordToken(word, precedence), word);
}

/**
 * The token kw() aliases, unnamed: a reserved-word set takes tokens, and the alias only renames this one token, so
 * reserving it reserves the keyword.
 *
 * @param {string} word - the keyword, spelled lowercase
 * @param {number} precedence - see kw()
 */
function keywordToken(word, precedence) {
    const insensitive = [...word].map((c) => `[${c}${c.toUpperCase()}]`).join("");
    return token(prec(precedence, new RegExp(insensitive)));
}

function commaSep(rule) {
    return seq(rule, repeat(seq(",", rule)));
}

/**
 * A `call` up to its terminator, shared by call_stmt and the unterminated macro-body twin. The target is a
 * procedure name or a string naming one, with or without arguments; `in` schedules the call after a delay and
 * `when` makes it conditional.
 *
 * @param {GrammarSymbols<string>} $
 */
function callBody($) {
    return seq(
        // SSL keywords are case-insensitive; real scripts write `Call Foo;`. Matched as a plain
        // literal it lexes as an identifier and the statement silently becomes two expression
        // statements rather than a call.
        kw("call"),
        field("target", choice($.identifier, $.string, $.call_expr)),
        optional(
            choice(seq(kw("in"), field("delay", $._expression)), seq(kw("when"), field("condition", $._expression))),
        ),
    );
}
