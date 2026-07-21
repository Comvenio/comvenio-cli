import type { OAuthScope } from "@comvenio/connector-contracts";
import type { JsonSchemaDocument, ProviderToolAnnotations, ToolCatalogSnapshot } from "@comvenio/tool-catalog";

export const ANTHROPIC_WIDGET_RESOURCE_URIS = [
  "ui://comvenio/event-calendar",
  "ui://comvenio/member-management",
  "ui://comvenio/booking-object",
  "ui://comvenio/news",
  "ui://comvenio/action-confirmation",
] as const;

export type AnthropicWidgetResourceUri = typeof ANTHROPIC_WIDGET_RESOURCE_URIS[number];
export type ClaudeSurface = "web" | "desktop" | "mobile";

export interface ClaudeDirectoryManifest {
  schema_version: "1.0.0";
  product_name: "Comvenio";
  tagline: "Dein Verein. Dein KI-Agent. Direkt im Chat.";
  short_description: "Vereinsarbeit sicher organisieren, Termine finden und erlaubte Aufgaben direkt im Chat erledigen.";
  publisher_name: "Comvenio";
  categories: ["Productivity"];
  website_url: "https://www.comvenio.app";
  documentation_url: "https://www.comvenio.app/hilfe";
  privacy_url: "https://www.comvenio.app/datenschutz";
  terms_url: "https://www.comvenio.app/agb";
  imprint_url: "https://www.comvenio.app/impressum";
  support_email: "support@comvenio.de";
  locale: "de-DE";
  provider: "anthropic";
  submission_kind: "remote_mcp_with_mcp_apps";
  directory_slug: "comvenio";
  remote_mcp_url: "https://mcp.comvenio.app/mcp";
  transport: "streamable_http";
  oauth_protected_resource_url: "https://mcp.comvenio.app/.well-known/oauth-protected-resource";
  oauth_metadata_url: "https://api.comvenio.app/auth/.well-known/oauth-authorization-server";
  auth: {
    type: "oauth_cimd";
    client_type: "public";
    token_endpoint_auth_method: "none";
    pkce_method: "S256";
    dynamic_client_registration: false;
    anthropic_held_credentials: false;
  };
  capabilities: { tools: true; prompts: true; resources: true; mcp_apps: true };
  allowed_link_uris: [];
  widget_resource_uris: [...typeof ANTHROPIC_WIDGET_RESOURCE_URIS];
  tool_sync_version: string;
  assets: { icon: "./assets/icon.svg"; logo: "./assets/logo.png" };
  screenshots: Array<{
    resource_uri: AnthropicWidgetResourceUri;
    path: string;
    prompt: string;
    format: "png";
    app_response_only: true;
    synthetic_data_only: true;
  }>;
}

export interface AnthropicToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaDocument;
  outputSchema: JsonSchemaDocument;
  requiredScopes: OAuthScope[];
  annotations: ProviderToolAnnotations;
  _meta?: { ui: { resourceUri: AnthropicWidgetResourceUri } };
}

export interface AnthropicAdapterInput {
  catalog: ToolCatalogSnapshot;
  schemas: ReadonlyMap<string, JsonSchemaDocument>;
}

export interface ClaudeToolSyncCase {
  tool_name: string;
  happy_path_prompt: string;
  permission_denied_prompt: string;
  expected_response_fixture: string;
  required_clients: ["mcp_inspector", "claude_custom_connector"];
  required_surfaces: ["web", "desktop", "mobile"];
}

export interface ClaudeToolSyncPlan {
  schema_version: "1.0.0";
  tool_sync_version: string;
  coverage: "every_published_tool";
  cases: ClaudeToolSyncCase[];
}

export interface ClaudeToolDrift {
  tool_name: string;
  changed_fields: string[];
}

export interface ClaudeToolSyncReport {
  schema_version: "1.0.0";
  provider: "anthropic";
  tool_sync_version: string;
  status: "pass" | "blocked";
  expected_tool_count: number;
  observed_tool_count: number;
  missing_tools: string[];
  extra_tools: string[];
  drift: ClaudeToolDrift[];
}

export interface ClaudeReviewerScenario {
  id: string;
  title: string;
  account_role: "anonymous" | "member" | "manager";
  surfaces: ClaudeSurface[];
  expected: string;
}

export interface ClaudeReviewerRunbook {
  schema_version: "1.0.0";
  document_path: "./submission/reviewer-runbook.md";
  reviewer_accounts: ["member", "manager"];
  mfa_forbidden: true;
  scenarios: ClaudeReviewerScenario[];
}

export interface ClaudeSubmissionEvidence {
  organization_plan: "individual" | "team" | "enterprise";
  directory_management_access: boolean;
  directory_slug_verified: boolean;
  public_remote_mcp_verified: boolean;
  origin_header_validation_verified: boolean;
  oauth_cimd_verified: boolean;
  public_documentation_verified: boolean;
  privacy_policy_verified: boolean;
  support_verified: boolean;
  first_party_api_verified: boolean;
  unsupported_use_cases_absent: boolean;
  tool_sync_report: ClaudeToolSyncReport;
  tool_results: Array<{
    tool_name: string;
    happy_path_passed: boolean;
    permission_denied_passed: boolean;
    mcp_inspector_passed: boolean;
    claude_custom_connector_passed: boolean;
    expected_response_fixture: string;
  }>;
  reviewer_accounts: Array<{
    role: "member" | "manager";
    fully_populated: boolean;
    login_ready: boolean;
    mfa_required: boolean;
    secret_reference: string;
  }>;
  widget_surfaces: Array<{
    resource_uri: AnthropicWidgetResourceUri;
    surfaces: ClaudeSurface[];
    same_widget_build: boolean;
  }>;
  review_findings: Array<{ id: string; severity: "low" | "medium" | "high" | "critical"; status: "open" | "resolved" }>;
}

export interface ClaudeSubmissionCheck {
  code: string;
  status: "pass" | "block";
  message: string;
}

export interface ClaudeSubmissionPreflightReport {
  schema_version: "1.0.0";
  provider: "anthropic";
  state: "ready" | "blocked";
  checks: ClaudeSubmissionCheck[];
}

export interface ClaudeSubmissionBundle {
  schema_version: "1.0.0";
  provider: "anthropic";
  manifest: ClaudeDirectoryManifest;
  tools: AnthropicToolDescriptor[];
  tool_sync_plan: ClaudeToolSyncPlan;
  tool_sync_report: ClaudeToolSyncReport;
  reviewer_runbook: ClaudeReviewerRunbook;
  preflight: ClaudeSubmissionPreflightReport;
}
