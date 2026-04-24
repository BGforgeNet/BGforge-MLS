import { definePlugin, defineRule } from "@oxlint/plugins";

const rule = defineRule({
    meta: {
        docs: {
            description: "Ban direct showMessage calls in server code",
            recommended: true,
        },
    },
    create(context) {
        const restrictedMethods = ["showInformationMessage", "showWarningMessage", "showErrorMessage"];
        const messages = {
            showInformationMessage:
                "Use showInfo() from user-messages.ts instead of connection.window.showInformationMessage(). It auto-decodes file:// URIs.",
            showWarningMessage:
                "Use showWarning() from user-messages.ts instead of connection.window.showWarningMessage(). It auto-decodes file:// URIs.",
            showErrorMessage:
                "Use showError() or showErrorWithActions() from user-messages.ts instead of connection.window.showErrorMessage(). It auto-decodes file:// URIs.",
        };

        return {
            MemberExpression(node) {
                if (
                    node.object.type === "MemberExpression" &&
                    node.object.property.type === "Identifier" &&
                    node.object.property.name === "window" &&
                    node.property.type === "Identifier" &&
                    restrictedMethods.includes(node.property.name)
                ) {
                    context.report({
                        node,
                        message: messages[node.property.name],
                    });
                }
            },
        };
    },
});

const plugin = definePlugin({
    meta: {
        name: "bgforge-mls",
    },
    rules: {
        "no-showmessage": rule,
    },
});

export default plugin;
