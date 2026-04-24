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
    AddStateTrigger = "add_state_trigger",
    AddTransAction = "add_trans_action",
    AddTransTrigger = "add_trans_trigger",
    AlterTrans = "alter_trans",
    AlterTransChange = "alter_trans_change",
    AppendAction = "append_action",
    AtVarRef = "at_var_ref",
    BeginAction = "begin_action",
    ChainAction = "chain_action",
    ChainBranch = "chain_branch",
    ChainEpilogue = "chain_epilogue",
    ChainSpeaker = "chain_speaker",
    ChainText = "chain_text",
    Comment = "comment",
    CopyTrans = "copy_trans",
    DActionWhen = "d_action_when",
    DoFeature = "do_feature",
    DoubleString = "double_string",
    ExitNext = "exit_next",
    ExtendAction = "extend_action",
    ExternNext = "extern_next",
    FlagsFeature = "flags_feature",
    GotoNext = "goto_next",
    InterjectAction = "interject_action",
    InterjectCopyTrans = "interject_copy_trans",
    JournalFeature = "journal_feature",
    LineComment = "line_comment",
    MacroExpansion = "macro_expansion",
    ReplaceAction = "replace_action",
    ReplaceActionText = "replace_action_text",
    ReplaceActionTextProcess = "replace_action_text_process",
    ReplaceActionTextRegexp = "replace_action_text_regexp",
    ReplaceSay = "replace_say",
    ReplaceStateTrigger = "replace_state_trigger",
    ReplaceTransAction = "replace_trans_action",
    ReplaceTransTrigger = "replace_trans_trigger",
    ReplaceTriggerText = "replace_trigger_text",
    ReplaceTriggerTextRegexp = "replace_trigger_text_regexp",
    ReplyFeature = "reply_feature",
    SayText = "say_text",
    SetWeight = "set_weight",
    ShortGoto = "short_goto",
    SourceFile = "source_file",
    State = "state",
    String = "string",
    TildeString = "tilde_string",
    Transition = "transition",
    TransitionFull = "transition_full",
    TransitionShort = "transition_short",
    DoubleContent = "double_content",
    Identifier = "identifier",
    Number = "number",
    StateLabelAlnum = "state_label_alnum",
    TildeContent = "tilde_content",
    TlkRef = "tlk_ref",
    TraRef = "tra_ref",
    VariableRef = "variable_ref",
}

export type UnnamedType =
    | '"'
    | "#"
    | "("
    | ")"
    | "+"
    | "-"
    | "/"
    | "/*"
    | "//"
    | "="
    | "=="
    | "ADD_STATE_TRIGGER"
    | "ADD_TRANS_ACTION"
    | "ADD_TRANS_TRIGGER"
    | "ALTER_TRANS"
    | "APPEND"
    | "APPEND_EARLY"
    | "AT"
    | "BEGIN"
    | "BRANCH"
    | "CHAIN"
    | "COPY_TRANS"
    | "COPY_TRANS_LATE"
    | "DO"
    | "END"
    | "EXIT"
    | "EXTEND_BOTTOM"
    | "EXTEND_TOP"
    | "EXTERN"
    | "FLAGS"
    | "GOTO"
    | "IF"
    | "IF_FILE_EXISTS"
    | "INTERJECT"
    | "INTERJECT_COPY_TRANS"
    | "INTERJECT_COPY_TRANS2"
    | "INTERJECT_COPY_TRANS3"
    | "INTERJECT_COPY_TRANS4"
    | "JOURNAL"
    | "REPLACE"
    | "REPLACE_ACTION_TEXT"
    | "REPLACE_ACTION_TEXT_PROCESS"
    | "REPLACE_ACTION_TEXT_PROCESS_REGEXP"
    | "REPLACE_ACTION_TEXT_REGEXP"
    | "REPLACE_SAY"
    | "REPLACE_STATE_TRIGGER"
    | "REPLACE_TRANS_ACTION"
    | "REPLACE_TRANS_TRIGGER"
    | "REPLACE_TRIGGER_TEXT"
    | "REPLACE_TRIGGER_TEXT_REGEXP"
    | "REPLY"
    | "R_A_T_P_R"
    | "SAFE"
    | "SAY"
    | "SET_WEIGHT"
    | "SOLVED_JOURNAL"
    | "THEN"
    | "UNLESS"
    | "UNSOLVED_JOURNAL"
    | "WEIGHT"
    | "~";

export type TypeString = SyntaxType | UnnamedType;

export type SyntaxNode =
    | AddStateTriggerNode
    | AddTransActionNode
    | AddTransTriggerNode
    | AlterTransNode
    | AlterTransChangeNode
    | AppendActionNode
    | AtVarRefNode
    | BeginActionNode
    | ChainActionNode
    | ChainBranchNode
    | ChainEpilogueNode
    | ChainSpeakerNode
    | ChainTextNode
    | CommentNode
    | CopyTransNode
    | DActionWhenNode
    | DoFeatureNode
    | DoubleStringNode
    | ExitNextNode
    | ExtendActionNode
    | ExternNextNode
    | FlagsFeatureNode
    | GotoNextNode
    | InterjectActionNode
    | InterjectCopyTransNode
    | JournalFeatureNode
    | LineCommentNode
    | MacroExpansionNode
    | ReplaceActionNode
    | ReplaceActionTextNode
    | ReplaceActionTextProcessNode
    | ReplaceActionTextRegexpNode
    | ReplaceSayNode
    | ReplaceStateTriggerNode
    | ReplaceTransActionNode
    | ReplaceTransTriggerNode
    | ReplaceTriggerTextNode
    | ReplaceTriggerTextRegexpNode
    | ReplyFeatureNode
    | SayTextNode
    | SetWeightNode
    | ShortGotoNode
    | SourceFileNode
    | StateNode
    | StringNode
    | TildeStringNode
    | TransitionNode
    | TransitionFullNode
    | TransitionShortNode
    | UnnamedNode<'"'>
    | UnnamedNode<"#">
    | UnnamedNode<"(">
    | UnnamedNode<")">
    | UnnamedNode<"+">
    | UnnamedNode<"-">
    | UnnamedNode<"/">
    | UnnamedNode<"/*">
    | UnnamedNode<"//">
    | UnnamedNode<"=">
    | UnnamedNode<"==">
    | UnnamedNode<"ADD_STATE_TRIGGER">
    | UnnamedNode<"ADD_TRANS_ACTION">
    | UnnamedNode<"ADD_TRANS_TRIGGER">
    | UnnamedNode<"ALTER_TRANS">
    | UnnamedNode<"APPEND">
    | UnnamedNode<"APPEND_EARLY">
    | UnnamedNode<"AT">
    | UnnamedNode<"BEGIN">
    | UnnamedNode<"BRANCH">
    | UnnamedNode<"CHAIN">
    | UnnamedNode<"COPY_TRANS">
    | UnnamedNode<"COPY_TRANS_LATE">
    | UnnamedNode<"DO">
    | UnnamedNode<"END">
    | UnnamedNode<"EXIT">
    | UnnamedNode<"EXTEND_BOTTOM">
    | UnnamedNode<"EXTEND_TOP">
    | UnnamedNode<"EXTERN">
    | UnnamedNode<"FLAGS">
    | UnnamedNode<"GOTO">
    | UnnamedNode<"IF">
    | UnnamedNode<"IF_FILE_EXISTS">
    | UnnamedNode<"INTERJECT">
    | UnnamedNode<"INTERJECT_COPY_TRANS">
    | UnnamedNode<"INTERJECT_COPY_TRANS2">
    | UnnamedNode<"INTERJECT_COPY_TRANS3">
    | UnnamedNode<"INTERJECT_COPY_TRANS4">
    | UnnamedNode<"JOURNAL">
    | UnnamedNode<"REPLACE">
    | UnnamedNode<"REPLACE_ACTION_TEXT">
    | UnnamedNode<"REPLACE_ACTION_TEXT_PROCESS">
    | UnnamedNode<"REPLACE_ACTION_TEXT_PROCESS_REGEXP">
    | UnnamedNode<"REPLACE_ACTION_TEXT_REGEXP">
    | UnnamedNode<"REPLACE_SAY">
    | UnnamedNode<"REPLACE_STATE_TRIGGER">
    | UnnamedNode<"REPLACE_TRANS_ACTION">
    | UnnamedNode<"REPLACE_TRANS_TRIGGER">
    | UnnamedNode<"REPLACE_TRIGGER_TEXT">
    | UnnamedNode<"REPLACE_TRIGGER_TEXT_REGEXP">
    | UnnamedNode<"REPLY">
    | UnnamedNode<"R_A_T_P_R">
    | UnnamedNode<"SAFE">
    | UnnamedNode<"SAY">
    | UnnamedNode<"SET_WEIGHT">
    | UnnamedNode<"SOLVED_JOURNAL">
    | UnnamedNode<"THEN">
    | UnnamedNode<"UNLESS">
    | UnnamedNode<"UNSOLVED_JOURNAL">
    | UnnamedNode<"WEIGHT">
    | DoubleContentNode
    | IdentifierNode
    | NumberNode
    | StateLabelAlnumNode
    | TildeContentNode
    | TlkRefNode
    | TraRefNode
    | VariableRefNode
    | UnnamedNode<"~">
    | ErrorNode;

export interface AddStateTriggerNode extends NamedNodeBase {
    type: SyntaxType.AddStateTrigger;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    stateNode: IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode;
    triggerNode: StringNode;
}

export interface AddTransActionNode extends NamedNodeBase {
    type: SyntaxType.AddTransAction;
    actionNode: StringNode;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
}

export interface AddTransTriggerNode extends NamedNodeBase {
    type: SyntaxType.AddTransTrigger;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    stateNode: IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode;
    triggerNode: StringNode;
}

export interface AlterTransNode extends NamedNodeBase {
    type: SyntaxType.AlterTrans;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
}

export interface AlterTransChangeNode extends NamedNodeBase {
    type: SyntaxType.AlterTransChange;
}

export interface AppendActionNode extends NamedNodeBase {
    type: SyntaxType.AppendAction;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
}

export interface AtVarRefNode extends NamedNodeBase {
    type: SyntaxType.AtVarRef;
}

export interface BeginActionNode extends NamedNodeBase {
    type: SyntaxType.BeginAction;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    non_pausingNode?: NumberNode;
}

export interface ChainActionNode extends NamedNodeBase {
    type: SyntaxType.ChainAction;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    labelNode: IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode;
    triggerNode?: StringNode;
}

export interface ChainBranchNode extends NamedNodeBase {
    type: SyntaxType.ChainBranch;
    triggerNode: StringNode;
}

export interface ChainEpilogueNode extends NamedNodeBase {
    type: SyntaxType.ChainEpilogue;
    fileNode?: IdentifierNode | StringNode | VariableRefNode;
    labelNode?: IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode;
}

export interface ChainSpeakerNode extends NamedNodeBase {
    type: SyntaxType.ChainSpeaker;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    triggerNode?: StringNode;
}

export interface ChainTextNode extends NamedNodeBase {
    type: SyntaxType.ChainText;
    triggerNode?: StringNode;
}

export interface CommentNode extends NamedNodeBase {
    type: SyntaxType.Comment;
}

export interface CopyTransNode extends NamedNodeBase {
    type: SyntaxType.CopyTrans;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    stateNode: IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode;
}

export interface DActionWhenNode extends NamedNodeBase {
    type: SyntaxType.DActionWhen;
    conditionNode: StringNode;
}

export interface DoFeatureNode extends NamedNodeBase {
    type: SyntaxType.DoFeature;
    actionNode: StringNode;
}

export interface DoubleStringNode extends NamedNodeBase {
    type: SyntaxType.DoubleString;
}

export interface ExitNextNode extends NamedNodeBase {
    type: SyntaxType.ExitNext;
}

export interface ExtendActionNode extends NamedNodeBase {
    type: SyntaxType.ExtendAction;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    statesNodes: (IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode)[];
}

export interface ExternNextNode extends NamedNodeBase {
    type: SyntaxType.ExternNext;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    labelNode: IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode;
}

export interface FlagsFeatureNode extends NamedNodeBase {
    type: SyntaxType.FlagsFeature;
}

export interface GotoNextNode extends NamedNodeBase {
    type: SyntaxType.GotoNext;
    labelNode: IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode;
}

export interface InterjectActionNode extends NamedNodeBase {
    type: SyntaxType.InterjectAction;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    global_varNode: IdentifierNode;
    labelNode: IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode;
}

export interface InterjectCopyTransNode extends NamedNodeBase {
    type: SyntaxType.InterjectCopyTrans;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    global_varNode: IdentifierNode;
    labelNode: IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode;
}

export interface JournalFeatureNode extends NamedNodeBase {
    type: SyntaxType.JournalFeature;
    textNode: AtVarRefNode | StringNode | TlkRefNode | TraRefNode;
}

export interface LineCommentNode extends NamedNodeBase {
    type: SyntaxType.LineComment;
}

export interface MacroExpansionNode extends NamedNodeBase {
    type: SyntaxType.MacroExpansion;
}

export interface ReplaceActionNode extends NamedNodeBase {
    type: SyntaxType.ReplaceAction;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
}

export interface ReplaceActionTextNode extends NamedNodeBase {
    type: SyntaxType.ReplaceActionText;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    new_textNode: StringNode;
    old_textNode: StringNode;
}

export interface ReplaceActionTextProcessNode extends NamedNodeBase {
    type: SyntaxType.ReplaceActionTextProcess;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    new_textNode: StringNode;
    old_textNode: StringNode;
}

export interface ReplaceActionTextRegexpNode extends NamedNodeBase {
    type: SyntaxType.ReplaceActionTextRegexp;
    fileNode: StringNode;
    new_textNode: StringNode;
    old_textNode: StringNode;
}

export interface ReplaceSayNode extends NamedNodeBase {
    type: SyntaxType.ReplaceSay;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    stateNode: IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode;
    textNode: AtVarRefNode | StringNode | TlkRefNode | TraRefNode;
}

export interface ReplaceStateTriggerNode extends NamedNodeBase {
    type: SyntaxType.ReplaceStateTrigger;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    stateNode: IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode;
    triggerNode: StringNode;
}

export interface ReplaceTransActionNode extends NamedNodeBase {
    type: SyntaxType.ReplaceTransAction;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    new_textNode: StringNode;
    old_textNode: StringNode;
}

export interface ReplaceTransTriggerNode extends NamedNodeBase {
    type: SyntaxType.ReplaceTransTrigger;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    new_textNode: StringNode;
    old_textNode: StringNode;
}

export interface ReplaceTriggerTextNode extends NamedNodeBase {
    type: SyntaxType.ReplaceTriggerText;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    new_textNode: StringNode;
    old_textNode: StringNode;
}

export interface ReplaceTriggerTextRegexpNode extends NamedNodeBase {
    type: SyntaxType.ReplaceTriggerTextRegexp;
    fileNode: StringNode;
    new_textNode: StringNode;
    old_textNode: StringNode;
}

export interface ReplyFeatureNode extends NamedNodeBase {
    type: SyntaxType.ReplyFeature;
    textNode: AtVarRefNode | StringNode | TlkRefNode | TraRefNode;
}

export interface SayTextNode extends NamedNodeBase {
    type: SyntaxType.SayText;
}

export interface SetWeightNode extends NamedNodeBase {
    type: SyntaxType.SetWeight;
    fileNode: IdentifierNode | StringNode | VariableRefNode;
    stateNode: IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode;
    weightNodes: (UnnamedNode<"#"> | UnnamedNode<"-"> | NumberNode)[];
}

export interface ShortGotoNode extends NamedNodeBase {
    type: SyntaxType.ShortGoto;
    labelNode: IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode;
}

export interface SourceFileNode extends NamedNodeBase {
    type: SyntaxType.SourceFile;
}

export interface StateNode extends NamedNodeBase {
    type: SyntaxType.State;
    labelNode: IdentifierNode | StateLabelAlnumNode | StringNode | VariableRefNode;
    sayNode: SayTextNode;
    triggerNode: StringNode;
    weightNodes: (UnnamedNode<"#"> | UnnamedNode<"-"> | NumberNode)[];
}

export interface StringNode extends NamedNodeBase {
    type: SyntaxType.String;
}

export interface TildeStringNode extends NamedNodeBase {
    type: SyntaxType.TildeString;
}

export interface TransitionNode extends NamedNodeBase {
    type: SyntaxType.Transition;
}

export interface TransitionFullNode extends NamedNodeBase {
    type: SyntaxType.TransitionFull;
    triggerNode: StringNode;
}

export interface TransitionShortNode extends NamedNodeBase {
    type: SyntaxType.TransitionShort;
    replyNode: AtVarRefNode | StringNode | TlkRefNode | TraRefNode;
    triggerNode?: StringNode;
}

export interface DoubleContentNode extends NamedNodeBase {
    type: SyntaxType.DoubleContent;
}

export interface IdentifierNode extends NamedNodeBase {
    type: SyntaxType.Identifier;
}

export interface NumberNode extends NamedNodeBase {
    type: SyntaxType.Number;
}

export interface StateLabelAlnumNode extends NamedNodeBase {
    type: SyntaxType.StateLabelAlnum;
}

export interface TildeContentNode extends NamedNodeBase {
    type: SyntaxType.TildeContent;
}

export interface TlkRefNode extends NamedNodeBase {
    type: SyntaxType.TlkRef;
}

export interface TraRefNode extends NamedNodeBase {
    type: SyntaxType.TraRef;
}

export interface VariableRefNode extends NamedNodeBase {
    type: SyntaxType.VariableRef;
}
