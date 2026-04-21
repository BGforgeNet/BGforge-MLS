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
  bufferSize?: number, includedRanges?: Range[];
};

export type Point = {
  row: number;
  column: number;
};

export type Range = {
  startIndex: number,
  endIndex: number,
  startPosition: Point,
  endPosition: Point
};

export type Edit = {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: Point;
  oldEndPosition: Point;
  newEndPosition: Point;
};

export type Logger = (
  message: string,
  params: { [param: string]: string },
  type: "parse" | "lex"
) => void;

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
  descendantsOfType<T extends TypeString>(types: T | readonly T[], startPosition?: Point, endPosition?: Point): NodeOfType<T>[];

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
  ArrayExpr = "array_expr",
  Assignment = "assignment",
  BinaryExpr = "binary_expr",
  Block = "block",
  Boolean = "boolean",
  BreakStmt = "break_stmt",
  CallExpr = "call_expr",
  CallStmt = "call_stmt",
  CaseClause = "case_clause",
  ContinueStmt = "continue_stmt",
  DefaultClause = "default_clause",
  Define = "define",
  Endif = "endif",
  ExportDecl = "export_decl",
  ExpressionStmt = "expression_stmt",
  ForInitAssign = "for_init_assign",
  ForStmt = "for_stmt",
  ForUpdateAssign = "for_update_assign",
  ForVarDecl = "for_var_decl",
  ForeachStmt = "foreach_stmt",
  IfStmt = "if_stmt",
  Ifdef = "ifdef",
  Ifndef = "ifndef",
  Include = "include",
  MacroBody = "macro_body",
  MacroCallStmt = "macro_call_stmt",
  MacroParams = "macro_params",
  MapEntry = "map_entry",
  MapExpr = "map_expr",
  MemberExpr = "member_expr",
  Param = "param",
  ParamDefault = "param_default",
  ParamDefaultGroup = "param_default_group",
  ParamDefaultUnary = "param_default_unary",
  ParamList = "param_list",
  ParenExpr = "paren_expr",
  PpElse = "pp_else",
  Preprocessor = "preprocessor",
  ProcRef = "proc_ref",
  Procedure = "procedure",
  ProcedureForward = "procedure_forward",
  ReturnStmt = "return_stmt",
  SourceFile = "source_file",
  SubscriptExpr = "subscript_expr",
  SwitchStmt = "switch_stmt",
  TernaryExpr = "ternary_expr",
  TokenPasteIdentifier = "token_paste_identifier",
  UnaryExpr = "unary_expr",
  Undef = "undef",
  VarInit = "var_init",
  VariableDecl = "variable_decl",
  WhileStmt = "while_stmt",
  Comment = "comment",
  Identifier = "identifier",
  LineComment = "line_comment",
  Number = "number",
  OtherPreprocessor = "other_preprocessor",
  String = "string",
}

export type UnnamedType =
  | "!="
  | "#define"
  | "#else"
  | "#endif"
  | "#ifdef"
  | "#ifndef"
  | "#include"
  | "#undef"
  | "%"
  | "("
  | ")"
  | "*"
  | "*="
  | "+"
  | "++"
  | "+="
  | ","
  | "-"
  | "--"
  | "-="
  | "."
  | "/"
  | "/="
  | ":"
  | ":="
  | ";"
  | "<"
  | "<="
  | "="
  | "=="
  | ">"
  | ">="
  | "@"
  | "["
  | "]"
  | "^"
  | "and"
  | "andalso"
  | "begin"
  | "bnot"
  | "break"
  | "bwand"
  | "bwor"
  | "bwxor"
  | "call"
  | "case"
  | "continue"
  | "default"
  | "do"
  | "else"
  | "end"
  | "export"
  | "false"
  | "for"
  | "foreach"
  | "if"
  | "import"
  | "in"
  | "not"
  | "or"
  | "orelse"
  | SyntaxType.Procedure // both named and unnamed
  | "return"
  | "switch"
  | "then"
  | "true"
  | "variable"
  | "while"
  | "{"
  | "}"
  ;

export type TypeString = SyntaxType | UnnamedType;

export type SyntaxNode =
  | ArrayExprNode
  | AssignmentNode
  | BinaryExprNode
  | BlockNode
  | BooleanNode
  | BreakStmtNode
  | CallExprNode
  | CallStmtNode
  | CaseClauseNode
  | ContinueStmtNode
  | DefaultClauseNode
  | DefineNode
  | EndifNode
  | ExportDeclNode
  | ExpressionStmtNode
  | ForInitAssignNode
  | ForStmtNode
  | ForUpdateAssignNode
  | ForVarDeclNode
  | ForeachStmtNode
  | IfStmtNode
  | IfdefNode
  | IfndefNode
  | IncludeNode
  | MacroBodyNode
  | MacroCallStmtNode
  | MacroParamsNode
  | MapEntryNode
  | MapExprNode
  | MemberExprNode
  | ParamNode
  | ParamDefaultNode
  | ParamDefaultGroupNode
  | ParamDefaultUnaryNode
  | ParamListNode
  | ParenExprNode
  | PpElseNode
  | PreprocessorNode
  | ProcRefNode
  | ProcedureNode
  | ProcedureForwardNode
  | ReturnStmtNode
  | SourceFileNode
  | SubscriptExprNode
  | SwitchStmtNode
  | TernaryExprNode
  | TokenPasteIdentifierNode
  | UnaryExprNode
  | UndefNode
  | VarInitNode
  | VariableDeclNode
  | WhileStmtNode
  | UnnamedNode<"!=">
  | UnnamedNode<"#define">
  | UnnamedNode<"#else">
  | UnnamedNode<"#endif">
  | UnnamedNode<"#ifdef">
  | UnnamedNode<"#ifndef">
  | UnnamedNode<"#include">
  | UnnamedNode<"#undef">
  | UnnamedNode<"%">
  | UnnamedNode<"(">
  | UnnamedNode<")">
  | UnnamedNode<"*">
  | UnnamedNode<"*=">
  | UnnamedNode<"+">
  | UnnamedNode<"++">
  | UnnamedNode<"+=">
  | UnnamedNode<",">
  | UnnamedNode<"-">
  | UnnamedNode<"--">
  | UnnamedNode<"-=">
  | UnnamedNode<".">
  | UnnamedNode<"/">
  | UnnamedNode<"/=">
  | UnnamedNode<":">
  | UnnamedNode<":=">
  | UnnamedNode<";">
  | UnnamedNode<"<">
  | UnnamedNode<"<=">
  | UnnamedNode<"=">
  | UnnamedNode<"==">
  | UnnamedNode<">">
  | UnnamedNode<">=">
  | UnnamedNode<"@">
  | UnnamedNode<"[">
  | UnnamedNode<"]">
  | UnnamedNode<"^">
  | UnnamedNode<"and">
  | UnnamedNode<"andalso">
  | UnnamedNode<"begin">
  | UnnamedNode<"bnot">
  | UnnamedNode<"break">
  | UnnamedNode<"bwand">
  | UnnamedNode<"bwor">
  | UnnamedNode<"bwxor">
  | UnnamedNode<"call">
  | UnnamedNode<"case">
  | CommentNode
  | UnnamedNode<"continue">
  | UnnamedNode<"default">
  | UnnamedNode<"do">
  | UnnamedNode<"else">
  | UnnamedNode<"end">
  | UnnamedNode<"export">
  | UnnamedNode<"false">
  | UnnamedNode<"for">
  | UnnamedNode<"foreach">
  | IdentifierNode
  | UnnamedNode<"if">
  | UnnamedNode<"import">
  | UnnamedNode<"in">
  | LineCommentNode
  | UnnamedNode<"not">
  | NumberNode
  | UnnamedNode<"or">
  | UnnamedNode<"orelse">
  | OtherPreprocessorNode
  | UnnamedNode<SyntaxType.Procedure>
  | UnnamedNode<"return">
  | StringNode
  | UnnamedNode<"switch">
  | UnnamedNode<"then">
  | UnnamedNode<"true">
  | UnnamedNode<"variable">
  | UnnamedNode<"while">
  | UnnamedNode<"{">
  | UnnamedNode<"}">
  | ErrorNode
  ;

export interface ArrayExprNode extends NamedNodeBase {
  type: SyntaxType.ArrayExpr;
}

export interface AssignmentNode extends NamedNodeBase {
  type: SyntaxType.Assignment;
  leftNode: IdentifierNode | MemberExprNode | SubscriptExprNode | TokenPasteIdentifierNode;
  rightNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
}

export interface BinaryExprNode extends NamedNodeBase {
  type: SyntaxType.BinaryExpr;
  leftNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
  opNode: UnnamedNode<"!="> | UnnamedNode<"%"> | UnnamedNode<"*"> | UnnamedNode<"+"> | UnnamedNode<"-"> | UnnamedNode<"/"> | UnnamedNode<"<"> | UnnamedNode<"<="> | UnnamedNode<"=="> | UnnamedNode<">"> | UnnamedNode<">="> | UnnamedNode<"^"> | UnnamedNode<"and"> | UnnamedNode<"andalso"> | UnnamedNode<"bwand"> | UnnamedNode<"bwor"> | UnnamedNode<"bwxor"> | UnnamedNode<"in"> | UnnamedNode<"or"> | UnnamedNode<"orelse">;
  rightNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
}

export interface BlockNode extends NamedNodeBase {
  type: SyntaxType.Block;
}

export interface BooleanNode extends NamedNodeBase {
  type: SyntaxType.Boolean;
}

export interface BreakStmtNode extends NamedNodeBase {
  type: SyntaxType.BreakStmt;
}

export interface CallExprNode extends NamedNodeBase {
  type: SyntaxType.CallExpr;
  argsNodes: (UnnamedNode<","> | ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode)[];
  funcNode: IdentifierNode | TokenPasteIdentifierNode;
}

export interface CallStmtNode extends NamedNodeBase {
  type: SyntaxType.CallStmt;
  delayNode?: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
  targetNode: CallExprNode | IdentifierNode;
}

export interface CaseClauseNode extends NamedNodeBase {
  type: SyntaxType.CaseClause;
  valueNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
}

export interface ContinueStmtNode extends NamedNodeBase {
  type: SyntaxType.ContinueStmt;
}

export interface DefaultClauseNode extends NamedNodeBase {
  type: SyntaxType.DefaultClause;
}

export interface DefineNode extends NamedNodeBase {
  type: SyntaxType.Define;
  bodyNode?: MacroBodyNode;
  nameNode: IdentifierNode;
  paramsNode?: MacroParamsNode;
}

export interface EndifNode extends NamedNodeBase {
  type: SyntaxType.Endif;
}

export interface ExportDeclNode extends NamedNodeBase {
  type: SyntaxType.ExportDecl;
  nameNode: IdentifierNode;
  valueNode?: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
}

export interface ExpressionStmtNode extends NamedNodeBase {
  type: SyntaxType.ExpressionStmt;
}

export interface ForInitAssignNode extends NamedNodeBase {
  type: SyntaxType.ForInitAssign;
  nameNode: IdentifierNode;
  valueNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
}

export interface ForStmtNode extends NamedNodeBase {
  type: SyntaxType.ForStmt;
  bodyNode: AssignmentNode | BlockNode | BreakStmtNode | CallStmtNode | ContinueStmtNode | ExpressionStmtNode | ForStmtNode | ForeachStmtNode | IfStmtNode | PreprocessorNode | ReturnStmtNode | SwitchStmtNode | VariableDeclNode | WhileStmtNode;
  condNode?: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
  initNode?: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | ForInitAssignNode | ForVarDeclNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
  updateNode?: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | ForUpdateAssignNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
}

export interface ForUpdateAssignNode extends NamedNodeBase {
  type: SyntaxType.ForUpdateAssign;
  leftNode: IdentifierNode | MemberExprNode | SubscriptExprNode;
  rightNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
}

export interface ForVarDeclNode extends NamedNodeBase {
  type: SyntaxType.ForVarDecl;
  nameNode: IdentifierNode;
  valueNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
}

export interface ForeachStmtNode extends NamedNodeBase {
  type: SyntaxType.ForeachStmt;
  bodyNode: AssignmentNode | BlockNode | BreakStmtNode | CallStmtNode | ContinueStmtNode | ExpressionStmtNode | ForStmtNode | ForeachStmtNode | IfStmtNode | PreprocessorNode | ReturnStmtNode | SwitchStmtNode | VariableDeclNode | WhileStmtNode;
  iterNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
  keyNode?: IdentifierNode;
  valueNode?: IdentifierNode;
  varNode?: IdentifierNode;
  while_condNode?: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
}

export interface IfStmtNode extends NamedNodeBase {
  type: SyntaxType.IfStmt;
  condNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
  elseNode?: AssignmentNode | BlockNode | BreakStmtNode | CallStmtNode | ContinueStmtNode | ExpressionStmtNode | ForStmtNode | ForeachStmtNode | IfStmtNode | PreprocessorNode | ReturnStmtNode | SwitchStmtNode | VariableDeclNode | WhileStmtNode;
  thenNode: AssignmentNode | BlockNode | BreakStmtNode | CallStmtNode | ContinueStmtNode | ExpressionStmtNode | ForStmtNode | ForeachStmtNode | IfStmtNode | PreprocessorNode | ReturnStmtNode | SwitchStmtNode | VariableDeclNode | WhileStmtNode;
}

export interface IfdefNode extends NamedNodeBase {
  type: SyntaxType.Ifdef;
  nameNode: IdentifierNode;
}

export interface IfndefNode extends NamedNodeBase {
  type: SyntaxType.Ifndef;
  nameNode: IdentifierNode;
}

export interface IncludeNode extends NamedNodeBase {
  type: SyntaxType.Include;
  pathNode: IdentifierNode | StringNode;
}

export interface MacroBodyNode extends NamedNodeBase {
  type: SyntaxType.MacroBody;
}

export interface MacroCallStmtNode extends NamedNodeBase {
  type: SyntaxType.MacroCallStmt;
  nameNode: IdentifierNode;
}

export interface MacroParamsNode extends NamedNodeBase {
  type: SyntaxType.MacroParams;
}

export interface MapEntryNode extends NamedNodeBase {
  type: SyntaxType.MapEntry;
  keyNode: IdentifierNode | NumberNode | StringNode;
  valueNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
}

export interface MapExprNode extends NamedNodeBase {
  type: SyntaxType.MapExpr;
}

export interface MemberExprNode extends NamedNodeBase {
  type: SyntaxType.MemberExpr;
  memberNode: IdentifierNode;
  objectNode: IdentifierNode | MemberExprNode | SubscriptExprNode;
}

export interface ParamNode extends NamedNodeBase {
  type: SyntaxType.Param;
  defaultNode?: ParamDefaultNode;
  nameNode: IdentifierNode;
}

export interface ParamDefaultNode extends NamedNodeBase {
  type: SyntaxType.ParamDefault;
}

export interface ParamDefaultGroupNode extends NamedNodeBase {
  type: SyntaxType.ParamDefaultGroup;
}

export interface ParamDefaultUnaryNode extends NamedNodeBase {
  type: SyntaxType.ParamDefaultUnary;
  exprNode: ParamDefaultNode;
  opNode: UnnamedNode<"-"> | UnnamedNode<"bnot"> | UnnamedNode<"not">;
}

export interface ParamListNode extends NamedNodeBase {
  type: SyntaxType.ParamList;
}

export interface ParenExprNode extends NamedNodeBase {
  type: SyntaxType.ParenExpr;
}

export interface PpElseNode extends NamedNodeBase {
  type: SyntaxType.PpElse;
}

export interface PreprocessorNode extends NamedNodeBase {
  type: SyntaxType.Preprocessor;
}

export interface ProcRefNode extends NamedNodeBase {
  type: SyntaxType.ProcRef;
}

export interface ProcedureNode extends NamedNodeBase {
  type: SyntaxType.Procedure;
  bodyNodes: (AssignmentNode | BreakStmtNode | CallStmtNode | ContinueStmtNode | ExpressionStmtNode | ForStmtNode | ForeachStmtNode | IfStmtNode | PreprocessorNode | ReturnStmtNode | SwitchStmtNode | VariableDeclNode | WhileStmtNode)[];
  nameNode: IdentifierNode;
  paramsNode?: ParamListNode;
}

export interface ProcedureForwardNode extends NamedNodeBase {
  type: SyntaxType.ProcedureForward;
  nameNode: IdentifierNode;
  paramsNode?: ParamListNode;
}

export interface ReturnStmtNode extends NamedNodeBase {
  type: SyntaxType.ReturnStmt;
}

export interface SourceFileNode extends NamedNodeBase {
  type: SyntaxType.SourceFile;
}

export interface SubscriptExprNode extends NamedNodeBase {
  type: SyntaxType.SubscriptExpr;
  indexNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
  objectNode: IdentifierNode | MemberExprNode | SubscriptExprNode;
}

export interface SwitchStmtNode extends NamedNodeBase {
  type: SyntaxType.SwitchStmt;
  valueNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
}

export interface TernaryExprNode extends NamedNodeBase {
  type: SyntaxType.TernaryExpr;
  condNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
  false_valueNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
  true_valueNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
}

export interface TokenPasteIdentifierNode extends NamedNodeBase {
  type: SyntaxType.TokenPasteIdentifier;
}

export interface UnaryExprNode extends NamedNodeBase {
  type: SyntaxType.UnaryExpr;
  exprNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
  opNode: UnnamedNode<"++"> | UnnamedNode<"-"> | UnnamedNode<"--"> | UnnamedNode<"bnot"> | UnnamedNode<"not">;
}

export interface UndefNode extends NamedNodeBase {
  type: SyntaxType.Undef;
  nameNode: IdentifierNode;
}

export interface VarInitNode extends NamedNodeBase {
  type: SyntaxType.VarInit;
  nameNode: IdentifierNode | TokenPasteIdentifierNode;
  sizeNode?: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
  valueNode?: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
}

export interface VariableDeclNode extends NamedNodeBase {
  type: SyntaxType.VariableDecl;
}

export interface WhileStmtNode extends NamedNodeBase {
  type: SyntaxType.WhileStmt;
  bodyNode: AssignmentNode | BlockNode | BreakStmtNode | CallStmtNode | ContinueStmtNode | ExpressionStmtNode | ForStmtNode | ForeachStmtNode | IfStmtNode | PreprocessorNode | ReturnStmtNode | SwitchStmtNode | VariableDeclNode | WhileStmtNode;
  condNode: ArrayExprNode | BinaryExprNode | BooleanNode | CallExprNode | IdentifierNode | MapExprNode | MemberExprNode | NumberNode | ParenExprNode | ProcRefNode | StringNode | SubscriptExprNode | TernaryExprNode | TokenPasteIdentifierNode | UnaryExprNode;
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

export interface OtherPreprocessorNode extends NamedNodeBase {
  type: SyntaxType.OtherPreprocessor;
}

export interface StringNode extends NamedNodeBase {
  type: SyntaxType.String;
}

