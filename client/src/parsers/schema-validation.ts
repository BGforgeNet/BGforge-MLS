import { z } from "zod";

type PathSegment = PropertyKey;

interface SchemaValidationIssue {
    readonly actual: unknown;
    readonly code: string;
    readonly message: string;
    readonly path: readonly PathSegment[];
    readonly [key: string]: unknown;
}

class SchemaValidationError extends Error {
    readonly issues: readonly SchemaValidationIssue[];

    constructor(context: string, issues: readonly SchemaValidationIssue[]) {
        const details = issues.map((issue) => {
            const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "<root>";
            return `${path}: ${issue.message} (actual=${JSON.stringify(issue.actual)})`;
        }).join("; ");
        super(`${context}: ${details}`);
        this.name = "SchemaValidationError";
        this.issues = issues;
    }
}

function getValueAtPath(root: unknown, path: readonly PathSegment[]): unknown {
    let current = root;
    for (const segment of path) {
        if (typeof current !== "object" || current === null) {
            return undefined;
        }
        if (!(segment in current)) {
            return undefined;
        }
        current = (current as Record<PropertyKey, unknown>)[segment];
    }
    return current;
}

export function parseWithSchemaValidation<T>(
    schema: z.ZodType<T>,
    value: unknown,
    context: string,
): T {
    const parsed = schema.safeParse(value);
    if (parsed.success) {
        return parsed.data;
    }

    const issues: SchemaValidationIssue[] = parsed.error.issues.map((issue) => ({
        ...issue,
        actual: getValueAtPath(value, issue.path as PathSegment[]),
    }));
    throw new SchemaValidationError(context, issues);
}
