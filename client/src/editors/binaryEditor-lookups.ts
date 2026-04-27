// Bundle-boundary indirection. The webview bundle imports lookup helpers via
// this single re-export so a future addition of editor-side overrides (e.g.,
// a format-specific enum override or a field-key adapter) lands in one place
// without rewriting every webview rendering call site. Do not collapse to
// direct `@bgforge/binary` imports at the call sites.
export {
    resolveDisplayValue,
    resolveEnumLookup,
    resolveFlagLookup,
    resolveStringCharset,
    formatEnumDisplayValue,
} from "@bgforge/binary";
