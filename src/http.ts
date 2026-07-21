// Compatibility facade for the established CLI imports.
// The implementation lives in the shared client package so CLI and MCP can
// share transport code while command modules migrate package by package.
export * from "../packages/comvenio-client/src/legacy.ts";
