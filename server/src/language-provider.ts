/**
 * LanguageProvider type and supporting definitions.
 *
 * LanguageProvider is composed from capability interfaces defined in
 * core/capabilities.ts. Each capability represents a cohesive feature set.
 * All capabilities are optional (Partial) — providers implement only what
 * their language supports.
 *
 * Concrete providers can declare explicit `implements` clauses for type safety:
 *   class MyProvider implements ProviderBase, FormattingCapability, CompletionCapability { ... }
 *
 * This file re-exports all types from capabilities.ts so existing import
 * sites (`from "./language-provider"`) continue to work unchanged.
 */

// Re-export shared types and values
export { type FormatResult, HoverResult, type ProviderContext } from "./core/capabilities";

// Re-export all capability interfaces (also used locally for the LanguageProvider type alias)
export {
    type ProviderBase,
    type FormattingCapability,
    type SymbolCapability,
    type FoldingCapability,
    type NavigationCapability,
    type RenameCapability,
    type HoverCapability,
    type CompletionCapability,
    type DataCapability,
    type CompilationCapability,
    type IndexingCapability,
    type FeatureGateCapability,
    type SemanticTokenCapability,
    type InlayHintCapability,
    type WorkspaceSymbolCapability,
} from "./core/capabilities";

import type {
    ProviderBase,
    FormattingCapability,
    SymbolCapability,
    FoldingCapability,
    NavigationCapability,
    RenameCapability,
    HoverCapability,
    CompletionCapability,
    DataCapability,
    CompilationCapability,
    IndexingCapability,
    FeatureGateCapability,
    SemanticTokenCapability,
    InlayHintCapability,
    WorkspaceSymbolCapability,
} from "./core/capabilities";

/**
 * The core type for language support — composed from capability interfaces.
 *
 * All capabilities are optional (Partial). Providers implement only what
 * their language supports. The ProviderRegistry routes requests by checking
 * for the presence of each capability's methods.
 */
export type LanguageProvider = ProviderBase &
    Partial<FormattingCapability> &
    Partial<SymbolCapability> &
    Partial<FoldingCapability> &
    Partial<NavigationCapability> &
    Partial<RenameCapability> &
    Partial<HoverCapability> &
    Partial<CompletionCapability> &
    Partial<DataCapability> &
    Partial<CompilationCapability> &
    Partial<IndexingCapability> &
    Partial<FeatureGateCapability> &
    Partial<SemanticTokenCapability> &
    Partial<InlayHintCapability> &
    Partial<WorkspaceSymbolCapability>;
