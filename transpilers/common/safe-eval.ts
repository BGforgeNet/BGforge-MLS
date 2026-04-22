/**
 * Safe expression evaluator using recursive descent parsing.
 * Replaces `new Function()` for compile-time loop condition evaluation.
 *
 * Supports: numeric literals, arithmetic (+, -, *, /, %), comparisons
 * (<, <=, >, >=, ==, ===, !=, !==), boolean operators (&&, ||, !),
 * unary minus, and parentheses.
 *
 * Rejects: identifiers, property access, function calls, strings,
 * assignments, and any other constructs.
 */

/** Token types for the lexer */
const enum TokenType {
    Number,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    LParen,
    RParen,
    Lt,
    LtEq,
    Gt,
    GtEq,
    EqEq,
    EqEqEq,
    NotEq,
    NotEqEq,
    And,
    Or,
    Not,
    EOF,
}

interface Token {
    readonly type: TokenType;
    readonly value: number | undefined;
}

const SINGLE_CHAR_TOKENS: Readonly<Record<string, TokenType>> = {
    "+": TokenType.Plus,
    "-": TokenType.Minus,
    "*": TokenType.Star,
    "/": TokenType.Slash,
    "%": TokenType.Percent,
    "(": TokenType.LParen,
    ")": TokenType.RParen,
};

const EQUALITY_TYPES = new Set([TokenType.EqEq, TokenType.EqEqEq, TokenType.NotEq, TokenType.NotEqEq]);
const COMPARISON_TYPES = new Set([TokenType.Lt, TokenType.LtEq, TokenType.Gt, TokenType.GtEq]);
const ADDITIVE_TYPES = new Set([TokenType.Plus, TokenType.Minus]);
const MULTIPLICATIVE_TYPES = new Set([TokenType.Star, TokenType.Slash, TokenType.Percent]);

/**
 * Tokenize an expression string into a flat array of tokens.
 * Throws on any character that is not part of the supported grammar
 * (identifiers, strings, property access, etc.).
 */
function tokenize(expr: string): readonly Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < expr.length) {
        const ch = expr[i]!;

        // Skip whitespace
        if (ch === " " || ch === "\t") {
            i++;
            continue;
        }

        // Numbers (including decimals)
        if (ch >= "0" && ch <= "9") {
            let num = "";
            while (i < expr.length && ((expr[i]! >= "0" && expr[i]! <= "9") || expr[i] === ".")) {
                num += expr[i];
                i++;
            }
            tokens.push({ type: TokenType.Number, value: Number(num) });
            continue;
        }

        // Single-char operators
        const singleType = SINGLE_CHAR_TOKENS[ch];
        if (singleType !== undefined) {
            tokens.push({ type: singleType, value: undefined });
            i++;
            continue;
        }

        // Multi-char operators starting with <
        if (ch === "<") {
            if (expr[i + 1] === "=") {
                tokens.push({ type: TokenType.LtEq, value: undefined });
                i += 2;
            } else {
                tokens.push({ type: TokenType.Lt, value: undefined });
                i++;
            }
            continue;
        }

        // Multi-char operators starting with >
        if (ch === ">") {
            if (expr[i + 1] === "=") {
                tokens.push({ type: TokenType.GtEq, value: undefined });
                i += 2;
            } else {
                tokens.push({ type: TokenType.Gt, value: undefined });
                i++;
            }
            continue;
        }

        // == and ===
        if (ch === "=") {
            if (expr[i + 1] === "=" && expr[i + 2] === "=") {
                tokens.push({ type: TokenType.EqEqEq, value: undefined });
                i += 3;
            } else if (expr[i + 1] === "=") {
                tokens.push({ type: TokenType.EqEq, value: undefined });
                i += 2;
            } else {
                throw new Error(`Unsupported token: assignment '=' at position ${i}`);
            }
            continue;
        }

        // ! , != , !==
        if (ch === "!") {
            if (expr[i + 1] === "=" && expr[i + 2] === "=") {
                tokens.push({ type: TokenType.NotEqEq, value: undefined });
                i += 3;
            } else if (expr[i + 1] === "=") {
                tokens.push({ type: TokenType.NotEq, value: undefined });
                i += 2;
            } else {
                tokens.push({ type: TokenType.Not, value: undefined });
                i++;
            }
            continue;
        }

        // &&
        if (ch === "&") {
            if (expr[i + 1] === "&") {
                tokens.push({ type: TokenType.And, value: undefined });
                i += 2;
            } else {
                throw new Error(`Unsupported token: '&' at position ${i}. Use '&&' for logical AND.`);
            }
            continue;
        }

        // ||
        if (ch === "|") {
            if (expr[i + 1] === "|") {
                tokens.push({ type: TokenType.Or, value: undefined });
                i += 2;
            } else {
                throw new Error(`Unsupported token: '|' at position ${i}. Use '||' for logical OR.`);
            }
            continue;
        }

        // Anything else is unsupported (identifiers, strings, etc.)
        throw new Error(
            `Unsupported character '${ch}' at position ${i} in expression "${expr}". ` +
                `Only numbers, arithmetic, comparisons, and boolean operators are allowed.`,
        );
    }

    tokens.push({ type: TokenType.EOF, value: undefined });
    return tokens;
}

/**
 * Recursive descent parser and evaluator.
 *
 * Grammar (precedence low to high):
 *   expr       -> or_expr
 *   or_expr    -> and_expr ( '||' and_expr )*
 *   and_expr   -> equality ( '&&' equality )*
 *   equality   -> comparison ( ('==' | '===' | '!=' | '!==') comparison )*
 *   comparison -> addition ( ('<' | '<=' | '>' | '>=') addition )*
 *   addition   -> multiply ( ('+' | '-') multiply )*
 *   multiply   -> unary ( ('*' | '/' | '%') unary )*
 *   unary      -> '!' unary | '-' unary | primary
 *   primary    -> NUMBER | '(' expr ')'
 */
class Parser {
    private pos = 0;
    private readonly tokens: readonly Token[];

    constructor(tokens: readonly Token[]) {
        this.tokens = tokens;
    }

    parse(): number | boolean {
        const result = this.orExpr();
        if (this.current().type !== TokenType.EOF) {
            throw new Error(`Unexpected token at position ${this.pos}`);
        }
        return result;
    }

    private current(): Token {
        return this.tokens[this.pos]!;
    }

    private advance(): Token {
        const tok = this.tokens[this.pos]!;
        this.pos++;
        return tok;
    }

    private expect(type: TokenType): Token {
        const tok = this.current();
        if (tok.type !== type) {
            throw new Error(`Expected token type ${type}, got ${tok.type} at position ${this.pos}`);
        }
        return this.advance();
    }

    private orExpr(): number | boolean {
        let left = this.andExpr();
        while (this.current().type === TokenType.Or) {
            this.advance();
            const right = this.andExpr();
            left = Boolean(left) || Boolean(right);
        }
        return left;
    }

    private andExpr(): number | boolean {
        let left = this.equality();
        while (this.current().type === TokenType.And) {
            this.advance();
            const right = this.equality();
            left = Boolean(left) && Boolean(right);
        }
        return left;
    }

    private equality(): number | boolean {
        let left = this.comparison();
        while (EQUALITY_TYPES.has(this.current().type)) {
            const type = this.advance().type;
            const right = this.comparison();
            if (type === TokenType.EqEq) {
                // Implementing `==` semantics for the sandboxed evaluator.
                // eslint-disable-next-line eqeqeq
                left = left == right;
            } else if (type === TokenType.EqEqEq) {
                left = left === right;
            } else if (type === TokenType.NotEq) {
                // Implementing `!=` semantics for the sandboxed evaluator.
                // eslint-disable-next-line eqeqeq
                left = left != right;
            } else {
                left = left !== right;
            }
        }
        return left;
    }

    private comparison(): number | boolean {
        let left = this.addition();
        while (COMPARISON_TYPES.has(this.current().type)) {
            const type = this.advance().type;
            const right = this.addition();
            if (type === TokenType.Lt) {
                left = (left as number) < (right as number);
            } else if (type === TokenType.LtEq) {
                left = (left as number) <= (right as number);
            } else if (type === TokenType.Gt) {
                left = (left as number) > (right as number);
            } else {
                left = (left as number) >= (right as number);
            }
        }
        return left;
    }

    private addition(): number | boolean {
        let left = this.multiply() as number;
        while (ADDITIVE_TYPES.has(this.current().type)) {
            const type = this.advance().type;
            if (type === TokenType.Plus) {
                left = left + (this.multiply() as number);
            } else {
                left = left - (this.multiply() as number);
            }
        }
        return left;
    }

    private multiply(): number | boolean {
        let left = this.unary() as number;
        while (MULTIPLICATIVE_TYPES.has(this.current().type)) {
            const type = this.advance().type;
            if (type === TokenType.Star) {
                left = left * (this.unary() as number);
            } else if (type === TokenType.Slash) {
                left = left / (this.unary() as number);
            } else {
                left = left % (this.unary() as number);
            }
        }
        return left;
    }

    private unary(): number | boolean {
        if (this.current().type === TokenType.Not) {
            this.advance();
            return !this.unary();
        }
        if (this.current().type === TokenType.Minus) {
            this.advance();
            return -(this.unary() as number);
        }
        return this.primary();
    }

    private primary(): number | boolean {
        const tok = this.current();

        if (tok.type === TokenType.Number) {
            this.advance();
            return tok.value!;
        }

        if (tok.type === TokenType.LParen) {
            this.advance();
            const result = this.orExpr();
            this.expect(TokenType.RParen);
            return result;
        }

        throw new Error(`Unexpected token at position ${this.pos} in expression`);
    }
}

/**
 * Safely evaluate a simple arithmetic/comparison/boolean expression.
 *
 * Only supports numeric literals, arithmetic (+, -, *, /, %),
 * comparisons (<, <=, >, >=, ==, ===, !=, !==),
 * boolean operators (&&, ||, !), and parentheses.
 *
 * Throws on any unsupported construct (identifiers, property access,
 * function calls, strings, etc.).
 *
 * @param expr Expression string where all variables have already been substituted to numbers
 * @returns Evaluated result (number or boolean)
 */
export function safeEvaluate(expr: string): number | boolean {
    const tokens = tokenize(expr.trim());
    const parser = new Parser(tokens);
    return parser.parse();
}
