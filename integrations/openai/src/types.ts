import type { OAuthScope } from "@comvenio/connector-contracts";
import type { JsonSchemaDocument, ProviderToolAnnotations, ToolCatalogSnapshot } from "@comvenio/tool-catalog";

export const OPENAI_WIDGET_RESOURCE_URIS = [
  "ui://comvenio/event-calendar",
  "ui://comvenio/member-management",
  "ui://comvenio/booking-object",
  "ui://comvenio/news",
  "ui://comvenio/action-confirmation",
] as const;

export const OPENAI_RELEASE_WIDGET_RESOURCE_URIS = [
  "ui://comvenio/event-calendar",
  "ui://comvenio/news",
] as const;

export type OpenAiWidgetResourceUri = typeof OPENAI_WIDGET_RESOURCE_URIS[number];
export type SubmissionSurface = "web" | "mobile";

export interface DistributionProfile {
  schema_version: "1.0.0";
  product_name: "Comvenio";
  tagline: "Dein Verein. Dein KI-Agent. Direkt im Chat.";
  short_description: "Öffentliche Vereinsinfos, Termine und News abrufen sowie eigene Aufgaben und Erinnerungen sicher verwalten.";
  publisher_name: "Comvenio";
  category: "Productivity";
  website_url: "https://www.comvenio.app";
  privacy_url: "https://www.comvenio.app/datenschutz";
  terms_url: "https://www.comvenio.app/agb";
  imprint_url: "https://www.comvenio.app/impressum";
  support_email: "support@comvenio.de";
  locale: "de-DE";
  mcp_endpoint: "https://mcp.comvenio.app/mcp";
  starter_prompts: [string, string, string];
}

export interface ChatGptAppManifest extends DistributionProfile {
  provider: "openai";
  submission_kind: "plugin_with_mcp_app";
  oauth_protected_resource_url: "https://mcp.comvenio.app/.well-known/oauth-protected-resource";
  support_runbook_url: "https://www.comvenio.app/hilfe";
  widget_resource_uris: [...typeof OPENAI_RELEASE_WIDGET_RESOURCE_URIS];
  tool_catalog_version: string;
  assets: { icon: "./assets/icon.svg"; logo: "./assets/logo.png" };
  screenshots: Array<{ resource_uri: OpenAiWidgetResourceUri; surface: SubmissionSurface; path: string; synthetic_data_only: true }>;
  release_gate: "OPENAI_GLOBAL_RESIDENCY_ACCEPTED";
}

export type OpenAiSecurityScheme =
  | { type: "noauth" }
  | { type: "oauth2"; scopes: OAuthScope[] };

export interface OpenAiToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaDocument;
  outputSchema: JsonSchemaDocument;
  securitySchemes: OpenAiSecurityScheme[];
  annotations: ProviderToolAnnotations;
  _meta?: { ui: { resourceUri: OpenAiWidgetResourceUri } };
}

export interface OpenAiAdapterInput {
  catalog: ToolCatalogSnapshot;
  schemas: ReadonlyMap<string, JsonSchemaDocument>;
}

export interface ToolTestCase {
  tool_name: string;
  prompt: string;
  expected_response_fixture: string;
  required_surfaces: ["web", "mobile"];
  verifies: ["schema", "security_schemes", "annotations", "rbac_recheck"];
}

export interface OpenAiToolTestPlan {
  schema_version: "1.0.0";
  catalog_source_hash_sha256: string;
  coverage: "every_published_tool";
  cases: ToolTestCase[];
  submission_examples: Array<{
    id: string;
    polarity: "positive" | "negative";
    prompt: string;
    expected_behavior: string;
  }>;
}

export interface ReviewerScenario {
  id: string;
  title: string;
  account_role: "anonymous" | "member" | "manager";
  expected: string;
}

export interface OpenAiReviewerRunbook {
  schema_version: "1.0.0";
  document_path: "./submission/reviewer-runbook.md";
  reviewer_accounts: ["member", "manager"];
  mfa_forbidden: true;
  scenarios: ReviewerScenario[];
}

export interface OpenAiSubmissionEvidence {
  organization_verified: boolean;
  app_permissions: string[];
  project_data_residency: "global" | "eu";
  public_mcp_endpoint_verified: boolean;
  oauth_pkce_verified: boolean;
  widget_csp_verified: boolean;
  legal_links_verified: boolean;
  tool_results: Array<{ tool_name: string; prompt: string; expected_response_fixture: string; passed_web: boolean; passed_mobile: boolean }>;
  reviewer_accounts: Array<{ role: "member" | "manager"; login_ready: boolean; mfa_required: boolean; secret_reference: string }>;
  widget_evidence: Array<{ resource_uri: OpenAiWidgetResourceUri; surfaces: SubmissionSurface[]; screenshot_path: string; synthetic_data_only: boolean }>;
  global_residency_acceptance: { product_owner_signed: boolean; privacy_reviewer_signed: boolean };
}

export interface SubmissionCheck {
  code: string;
  status: "pass" | "block";
  message: string;
}

export interface OpenAiSubmissionPreflightReport {
  schema_version: "1.0.0";
  provider: "openai";
  state: "ready" | "blocked";
  checks: SubmissionCheck[];
}

export interface MarketplaceSubmissionBundle {
  schema_version: "1.0.0";
  provider: "openai";
  manifest: ChatGptAppManifest;
  tools: OpenAiToolDescriptor[];
  tool_test_plan: OpenAiToolTestPlan;
  reviewer_runbook: OpenAiReviewerRunbook;
  preflight: OpenAiSubmissionPreflightReport;
}
