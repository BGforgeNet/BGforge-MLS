import fs from "node:fs";
import path from "node:path";
import { definePlugin, defineRule } from "@oxlint/plugins";

// The generated enums are the authority on which strings name a tree-sitter node type. Keying the rule on
// them keeps an anonymous keyword token (`"then"`, `"BEGIN"`), which has no member, legal to compare by string.
const SYNTAX_TYPES_DIR = path.join(import.meta.dirname, "..", "shared", "syntax-types");

/** Node-type string -> the `Grammar.Member` spellings that name it, across every generated enum. */
function loadMembers() {
    const members = new Map();
    for (const file of fs.readdirSync(SYNTAX_TYPES_DIR)) {
        if (!file.endsWith(".ts")) continue;
        const grammar = file.slice(0, -3);
        const source = fs.readFileSync(path.join(SYNTAX_TYPES_DIR, file), "utf8");
        for (const match of source.matchAll(/^\s*(\w+) = "([^"]+)",?$/gm)) {
            const spelled = members.get(match[2]) ?? [];
            spelled.push(`SyntaxType.${match[1]} (${grammar})`);
            members.set(match[2], spelled);
        }
    }
    return members;
}

const MEMBERS = loadMembers();

function isStringLiteral(node) {
    return node.type === "Literal" && typeof node.value === "string";
}

function isTypeProperty(node) {
    return (
        node.type === "MemberExpression" &&
        !node.computed &&
        node.property.type === "Identifier" &&
        node.property.name === "type"
    );
}

const rule = defineRule({
    meta: {
        docs: {
            description: "Compare node.type against a SyntaxType member, never the string it spells",
            recommended: true,
        },
    },
    create(context) {
        return {
            BinaryExpression(node) {
                if (!["===", "!==", "==", "!="].includes(node.operator)) return;
                const literal = isStringLiteral(node.left)
                    ? node.left
                    : isStringLiteral(node.right)
                      ? node.right
                      : null;
                const member = isTypeProperty(node.left) ? node.left : isTypeProperty(node.right) ? node.right : null;
                if (!literal || !member) return;
                const spelled = MEMBERS.get(literal.value);
                if (!spelled) return;
                context.report({
                    node,
                    message: `Compare node.type against ${spelled.join(" or ")}, not the string "${literal.value}".`,
                });
            },
        };
    },
});

const plugin = definePlugin({
    // A plugin name is registered once per config, so this rule set cannot share the no-showmessage plugin's name.
    meta: {
        name: "bgforge-syntax",
    },
    rules: {
        "no-node-type-literal": rule,
    },
});

export default plugin;
