// Stable source locator from the normative provider contract. The implementation remains split
// into focused modules, but callers and contract tests enter through this operation-only compiler.
export {
  compileProviderCatalog,
  createToolGroupKey,
  createToolName,
  type ProviderCompilerInput,
  type ProviderCompilerOutput,
} from "./compiler.ts";
