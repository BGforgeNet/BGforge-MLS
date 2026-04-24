export class Parser {
    parse(input: string | Input, oldTree?: Tree, options?: Options): Tree;
    getIncludedRanges(): Range[];
    getTimeoutMicros(): number;
    setTimeoutMicros(timeout: number): void;
    reset(): void;
    getLanguage(): any;
    setLanguage(language?: any): void;
    getLogger(): Logger;
    setLogger(logFunc?: Logger | false | null): void;
    printDotGraphs(enabled?: boolean, fd?: number): void;
}

export type Options = {
    bufferSize?: number;
    includedRanges?: Range[];
};

export type Point = {
    row: number;
    column: number;
};

export type Range = {
    startIndex: number;
    endIndex: number;
    startPosition: Point;
    endPosition: Point;
};

export type Edit = {
    startIndex: number;
    oldEndIndex: number;
    newEndIndex: number;
    startPosition: Point;
    oldEndPosition: Point;
    newEndPosition: Point;
};

export type Logger = (message: string, params: { [param: string]: string }, type: "parse" | "lex") => void;

export interface Input {
    (index: number, position?: Point): string | null;
}

interface SyntaxNodeBase {
    tree: Tree;
    id: number;
    typeId: number;
    grammarId: number;
    type: string;
    grammarType: string;
    isNamed: boolean;
    isMissing: boolean;
    isExtra: boolean;
    hasChanges: boolean;
    hasError: boolean;
    isError: boolean;
    text: string;
    parseState: number;
    nextParseState: number;
    startPosition: Point;
    endPosition: Point;
    startIndex: number;
    endIndex: number;
    parent: SyntaxNode | null;
    children: Array<SyntaxNode>;
    namedChildren: Array<SyntaxNode>;
    childCount: number;
    namedChildCount: number;
    firstChild: SyntaxNode | null;
    firstNamedChild: SyntaxNode | null;
    lastChild: SyntaxNode | null;
    lastNamedChild: SyntaxNode | null;
    nextSibling: SyntaxNode | null;
    nextNamedSibling: SyntaxNode | null;
    previousSibling: SyntaxNode | null;
    previousNamedSibling: SyntaxNode | null;
    descendantCount: number;

    toString(): string;
    child(index: number): SyntaxNode | null;
    namedChild(index: number): SyntaxNode | null;
    childForFieldName(fieldName: string): SyntaxNode | null;
    childForFieldId(fieldId: number): SyntaxNode | null;
    fieldNameForChild(childIndex: number): string | null;
    childrenForFieldName(fieldName: string): Array<SyntaxNode>;
    childrenForFieldId(fieldId: number): Array<SyntaxNode>;
    firstChildForIndex(index: number): SyntaxNode | null;
    firstNamedChildForIndex(index: number): SyntaxNode | null;

    descendantForIndex(index: number): SyntaxNode;
    descendantForIndex(startIndex: number, endIndex: number): SyntaxNode;
    namedDescendantForIndex(index: number): SyntaxNode;
    namedDescendantForIndex(startIndex: number, endIndex: number): SyntaxNode;
    descendantForPosition(position: Point): SyntaxNode;
    descendantForPosition(startPosition: Point, endPosition: Point): SyntaxNode;
    namedDescendantForPosition(position: Point): SyntaxNode;
    namedDescendantForPosition(startPosition: Point, endPosition: Point): SyntaxNode;
    descendantsOfType<T extends TypeString>(
        types: T | readonly T[],
        startPosition?: Point,
        endPosition?: Point,
    ): NodeOfType<T>[];

    closest<T extends SyntaxType>(types: T | readonly T[]): NamedNode<T> | null;
    walk(): TreeCursor;
}

export interface TreeCursor {
    nodeType: string;
    nodeTypeId: number;
    nodeStateId: number;
    nodeText: string;
    nodeIsNamed: boolean;
    nodeIsMissing: boolean;
    startPosition: Point;
    endPosition: Point;
    startIndex: number;
    endIndex: number;
    readonly currentNode: SyntaxNode;
    readonly currentFieldName: string;
    readonly currentFieldId: number;
    readonly currentDepth: number;
    readonly currentDescendantIndex: number;

    reset(node: SyntaxNode): void;
    resetTo(cursor: TreeCursor): void;
    gotoParent(): boolean;
    gotoFirstChild(): boolean;
    gotoLastChild(): boolean;
    gotoFirstChildForIndex(goalIndex: number): boolean;
    gotoFirstChildForPosition(goalPosition: Point): boolean;
    gotoNextSibling(): boolean;
    gotoPreviousSibling(): boolean;
    gotoDescendant(goalDescendantIndex: number): void;
}

export interface Tree {
    readonly rootNode: SyntaxNode;

    rootNodeWithOffset(offsetBytes: number, offsetExtent: Point): SyntaxNode;
    edit(edit: Edit): Tree;
    walk(): TreeCursor;
    getChangedRanges(other: Tree): Range[];
    getIncludedRanges(): Range[];
    getEditedRange(other: Tree): Range;
    printDotGraph(fd?: number): void;
}

export interface QueryCapture {
    name: string;
    text?: string;
    node: SyntaxNode;
    setProperties?: { [prop: string]: string | null };
    assertedProperties?: { [prop: string]: string | null };
    refutedProperties?: { [prop: string]: string | null };
}

export interface QueryMatch {
    pattern: number;
    captures: QueryCapture[];
}

export type QueryOptions = {
    startPosition?: Point;
    endPosition?: Point;
    startIndex?: number;
    endIndex?: number;
    matchLimit?: number;
    maxStartDepth?: number;
};

export interface PredicateResult {
    operator: string;
    operands: { name: string; type: string }[];
}

export class Query {
    readonly predicates: { [name: string]: Function }[];
    readonly setProperties: any[];
    readonly assertedProperties: any[];
    readonly refutedProperties: any[];
    readonly matchLimit: number;

    constructor(language: any, source: string | Buffer);

    captures(node: SyntaxNode, options?: QueryOptions): QueryCapture[];
    matches(node: SyntaxNode, options?: QueryOptions): QueryMatch[];
    disableCapture(captureName: string): void;
    disablePattern(patternIndex: number): void;
    isPatternGuaranteedAtStep(byteOffset: number): boolean;
    isPatternRooted(patternIndex: number): boolean;
    isPatternNonLocal(patternIndex: number): boolean;
    startIndexForPattern(patternIndex: number): number;
    didExceedMatchLimit(): boolean;
}

export class LookaheadIterable {
    readonly currentTypeId: number;
    readonly currentType: string;

    reset(language: any, stateId: number): boolean;
    resetState(stateId: number): boolean;
    [Symbol.iterator](): Iterator<string>;
}

interface NamedNodeBase extends SyntaxNodeBase {
    isNamed: true;
}

/** An unnamed node with the given type string. */
export interface UnnamedNode<T extends string = string> extends SyntaxNodeBase {
    type: T;
    isNamed: false;
}

type PickNamedType<Node, T extends string> = Node extends { type: T; isNamed: true } ? Node : never;

type PickType<Node, T extends string> = Node extends { type: T } ? Node : never;

/** A named node with the given `type` string. */
export type NamedNode<T extends SyntaxType = SyntaxType> = PickNamedType<SyntaxNode, T>;

/**
 * A node with the given `type` string.
 *
 * Note that this matches both named and unnamed nodes. Use `NamedNode<T>` to pick only named nodes.
 */
export type NodeOfType<T extends string> = PickType<SyntaxNode, T>;

interface TreeCursorOfType<S extends string, T extends SyntaxNodeBase> {
    nodeType: S;
    currentNode: T;
}

type TreeCursorRecord = { [K in TypeString]: TreeCursorOfType<K, NodeOfType<K>> };

/**
 * A tree cursor whose `nodeType` correlates with `currentNode`.
 *
 * The typing becomes invalid once the underlying cursor is mutated.
 *
 * The intention is to cast a `TreeCursor` to `TypedTreeCursor` before
 * switching on `nodeType`.
 *
 * For example:
 * ```ts
 * let cursor = root.walk();
 * while (cursor.gotoNextSibling()) {
 *   const c = cursor as TypedTreeCursor;
 *   switch (c.nodeType) {
 *     case SyntaxType.Foo: {
 *       let node = c.currentNode; // Typed as FooNode.
 *       break;
 *     }
 *   }
 * }
 * ```
 */
export type TypedTreeCursor = TreeCursorRecord[keyof TreeCursorRecord];

export interface ErrorNode extends NamedNodeBase {
    type: SyntaxType.ERROR;
    hasError: true;
}

export enum SyntaxType {
    ERROR = "ERROR",
    Action = "action",
    Block = "block",
    CallExpr = "call_expr",
    Condition = "condition",
    IfClause = "if_clause",
    ObjectRef = "object_ref",
    OrMarker = "or_marker",
    Point = "point",
    Response = "response",
    SourceFile = "source_file",
    String = "string",
    ThenClause = "then_clause",
    Comment = "comment",
    Identifier = "identifier",
    LineComment = "line_comment",
    Number = "number",
    TraRef = "tra_ref",
    VariableRef = "variable_ref",
}

export type UnnamedType =
    | "!"
    | '"'
    | "#"
    | "("
    | ")"
    | ","
    | "."
    | "END"
    | "IF"
    | "OR"
    | "RESPONSE"
    | "THEN"
    | "["
    | "]"
    | "~";

export type TypeString = SyntaxType | UnnamedType;

export type SyntaxNode =
    | ActionNode
    | BlockNode
    | CallExprNode
    | ConditionNode
    | IfClauseNode
    | ObjectRefNode
    | OrMarkerNode
    | PointNode
    | ResponseNode
    | SourceFileNode
    | StringNode
    | ThenClauseNode
    | UnnamedNode<"!">
    | UnnamedNode<'"'>
    | UnnamedNode<"#">
    | UnnamedNode<"(">
    | UnnamedNode<")">
    | UnnamedNode<",">
    | UnnamedNode<".">
    | UnnamedNode<"END">
    | UnnamedNode<"IF">
    | UnnamedNode<"OR">
    | UnnamedNode<"RESPONSE">
    | UnnamedNode<"THEN">
    | UnnamedNode<"[">
    | UnnamedNode<"]">
    | CommentNode
    | IdentifierNode
    | LineCommentNode
    | NumberNode
    | TraRefNode
    | VariableRefNode
    | UnnamedNode<"~">
    | ErrorNode;

export interface ActionNode extends NamedNodeBase {
    type: SyntaxType.Action;
    callNode: CallExprNode;
}

export interface BlockNode extends NamedNodeBase {
    type: SyntaxType.Block;
    ifNode: IfClauseNode;
    thenNode: ThenClauseNode;
}

export interface CallExprNode extends NamedNodeBase {
    type: SyntaxType.CallExpr;
    argsNodes: (
        | CallExprNode
        | IdentifierNode
        | NumberNode
        | ObjectRefNode
        | PointNode
        | StringNode
        | TraRefNode
        | VariableRefNode
    )[];
    funcNode: IdentifierNode;
}

export interface ConditionNode extends NamedNodeBase {
    type: SyntaxType.Condition;
    callNode: CallExprNode;
}

export interface IfClauseNode extends NamedNodeBase {
    type: SyntaxType.IfClause;
}

export interface ObjectRefNode extends NamedNodeBase {
    type: SyntaxType.ObjectRef;
}

export interface OrMarkerNode extends NamedNodeBase {
    type: SyntaxType.OrMarker;
    countNode: NumberNode;
}

export interface PointNode extends NamedNodeBase {
    type: SyntaxType.Point;
}

export interface ResponseNode extends NamedNodeBase {
    type: SyntaxType.Response;
    weightNode: NumberNode;
}

export interface SourceFileNode extends NamedNodeBase {
    type: SyntaxType.SourceFile;
}

export interface StringNode extends NamedNodeBase {
    type: SyntaxType.String;
}

export interface ThenClauseNode extends NamedNodeBase {
    type: SyntaxType.ThenClause;
}

export interface CommentNode extends NamedNodeBase {
    type: SyntaxType.Comment;
}

export interface IdentifierNode extends NamedNodeBase {
    type: SyntaxType.Identifier;
}

export interface LineCommentNode extends NamedNodeBase {
    type: SyntaxType.LineComment;
}

export interface NumberNode extends NamedNodeBase {
    type: SyntaxType.Number;
}

export interface TraRefNode extends NamedNodeBase {
    type: SyntaxType.TraRef;
}

export interface VariableRefNode extends NamedNodeBase {
    type: SyntaxType.VariableRef;
}
