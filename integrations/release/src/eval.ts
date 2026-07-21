import { CONNECTOR_EVAL_REPORT_SCHEMA } from "./schemas.ts";
import type { ConnectorEvalReport, ConnectorEvalToolResult } from "./types.ts";

export class ConnectorEvalSuite {
  evaluate(input: { published_tool_names: string[]; results: ConnectorEvalToolResult[] }): ConnectorEvalReport {
    const published = [...input.published_tool_names].sort();
    const tested = input.results.map((result) => result.tool_name).sort();
    const blockers: string[] = [];
    if (new Set(published).size !== published.length || new Set(tested).size !== tested.length) blockers.push("DUPLICATE_TOOL_EVIDENCE");
    if (published.length === 0) blockers.push("NO_PUBLISHED_TOOLS");
    if (JSON.stringify(published) !== JSON.stringify(tested)) blockers.push("TOOL_EVAL_PARITY");
    if (input.results.some((result) => !result.tool_selection || !result.schema_validation || !result.grounded_response
      || !result.actionable_error || !result.safe_non_execution || !result.confirmation_contract
      || !result.provider_retry_idempotent || !result.synthetic_data_only)) blockers.push("TOOL_EVAL_FAILURE");
    return CONNECTOR_EVAL_REPORT_SCHEMA.parse({
      schema_version: "1.0.0",
      suite: "ConnectorEvalSuite",
      status: blockers.length === 0 ? "pass" : "blocked",
      published_tool_count: published.length,
      tested_tool_count: tested.length,
      results: [...input.results].sort((left, right) => left.tool_name.localeCompare(right.tool_name)),
      blockers,
    });
  }
}
