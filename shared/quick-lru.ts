/**
 * quick-lru, reached through this package: shared declares the dependency, and a package that imports shared
 * source (the client) uses the same copy rather than declaring a second.
 */
export { default as QuickLRU } from "quick-lru";
