import { z } from "zod";

const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "Es ist eine absolute HTTPS-URL erforderlich.");
const resourceUri = z.enum([
  "ui://comvenio/event-calendar",
  "ui://comvenio/member-management",
  "ui://comvenio/booking-object",
  "ui://comvenio/news",
  "ui://comvenio/action-confirmation",
]);
const localArtifact = z.string().regex(/^\.\/(?:assets|screenshots|submission)\/[a-z0-9][a-z0-9._/-]*$/u);

export const CLAUDE_DIRECTORY_MANIFEST_SCHEMA = z.object({
  schema_version: z.literal("1.0.0"),
  product_name: z.literal("Comvenio"),
  tagline: z.literal("Dein Verein. Dein KI-Agent. Direkt im Chat."),
  short_description: z.literal("Öffentliche Vereinsinfos, Termine und News abrufen und eigene freigegebene Möglichkeiten sicher verstehen."),
  publisher_name: z.literal("Comvenio"),
  categories: z.tuple([z.literal("Productivity")]),
  website_url: httpsUrl.pipe(z.literal("https://www.comvenio.app")),
  documentation_url: httpsUrl.pipe(z.literal("https://www.comvenio.app/hilfe")),
  privacy_url: httpsUrl.pipe(z.literal("https://www.comvenio.app/datenschutz")),
  terms_url: httpsUrl.pipe(z.literal("https://www.comvenio.app/agb")),
  imprint_url: httpsUrl.pipe(z.literal("https://www.comvenio.app/impressum")),
  support_email: z.literal("support@comvenio.de"),
  locale: z.literal("de-DE"),
  provider: z.literal("anthropic"),
  submission_kind: z.literal("remote_mcp_with_mcp_apps"),
  directory_slug: z.literal("comvenio"),
  remote_mcp_url: httpsUrl.pipe(z.literal("https://comvenio-cli-production.up.railway.app/mcp")),
  transport: z.literal("streamable_http"),
  oauth_protected_resource_url: httpsUrl.pipe(z.literal("https://comvenio-cli-production.up.railway.app/.well-known/oauth-protected-resource")),
  oauth_metadata_url: httpsUrl.pipe(z.literal("https://api.comvenio.app/auth/.well-known/oauth-authorization-server")),
  auth: z.object({
    type: z.literal("oauth_cimd"),
    client_type: z.literal("public"),
    token_endpoint_auth_method: z.literal("none"),
    pkce_method: z.literal("S256"),
    dynamic_client_registration: z.literal(false),
    anthropic_held_credentials: z.literal(false),
  }).strict(),
  capabilities: z.object({ tools: z.literal(true), prompts: z.literal(false), resources: z.literal(true), mcp_apps: z.literal(true) }).strict(),
  allowed_link_uris: z.tuple([]),
  widget_resource_uris: z.tuple([
    z.literal("ui://comvenio/event-calendar"),
    z.literal("ui://comvenio/news"),
  ]),
  tool_sync_version: z.string().regex(/^[a-f0-9]{64}$/u),
  assets: z.object({ icon: z.literal("./assets/icon.svg"), logo: z.literal("./assets/logo.png") }).strict(),
  screenshots: z.array(z.object({
    resource_uri: resourceUri,
    path: localArtifact,
    prompt: z.string().trim().min(1).max(500),
    format: z.literal("png"),
    app_response_only: z.literal(true),
    synthetic_data_only: z.literal(true),
  }).strict()).max(5),
}).strict().superRefine((manifest, context) => {
  if (manifest.product_name.length > 100 || manifest.tagline.length > 55 || manifest.short_description.length > 2_000) {
    context.addIssue({ code: "custom", message: "Directory-Name, Tagline oder Beschreibung überschreiten die Portalgrenze." });
  }
  const publishedWidgets = new Set<string>(manifest.widget_resource_uris);
  if (publishedWidgets.size !== 2 || manifest.screenshots.some((item) => !publishedWidgets.has(item.resource_uri))) {
    context.addIssue({ code: "custom", message: "Screenshots dürfen nur veröffentlichte Widgets zeigen." });
  }
  if (new Set(manifest.screenshots.map((item) => item.path)).size !== manifest.screenshots.length) {
    context.addIssue({ code: "custom", message: "Jeder Carousel-Screenshot benötigt einen eindeutigen Artefaktpfad." });
  }
});

export const CLAUDE_TOOL_SYNC_PLAN_SCHEMA = z.object({
  schema_version: z.literal("1.0.0"),
  tool_sync_version: z.string().regex(/^[a-f0-9]{64}$/u),
  coverage: z.literal("every_published_tool"),
  cases: z.array(z.object({
    tool_name: z.string().regex(/^[a-z0-9_.:-]{1,64}$/u),
    happy_path_prompt: z.string().trim().min(1).max(500),
    permission_denied_prompt: z.string().trim().min(1).max(500),
    expected_response_fixture: z.string().regex(/^fixtures\/provider\/anthropic\/[a-z0-9_.:-]+\.response\.json$/u),
    required_clients: z.tuple([z.literal("mcp_inspector"), z.literal("claude_custom_connector")]),
    required_surfaces: z.tuple([z.literal("web"), z.literal("desktop"), z.literal("mobile")]),
  }).strict()),
}).strict().superRefine((plan, context) => {
  if (new Set(plan.cases.map((item) => item.tool_name)).size !== plan.cases.length) {
    context.addIssue({ code: "custom", message: "Jedes veröffentlichte Tool darf nur einen Sync-Testfall besitzen." });
  }
});

export const CLAUDE_REVIEWER_RUNBOOK_SCHEMA = z.object({
  schema_version: z.literal("1.0.0"),
  document_path: z.literal("./submission/reviewer-runbook.md"),
  reviewer_accounts: z.tuple([z.literal("member"), z.literal("manager")]),
  mfa_forbidden: z.literal(true),
  scenarios: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/u),
    title: z.string().trim().min(1),
    account_role: z.enum(["anonymous", "member", "manager"]),
    surfaces: z.array(z.enum(["web", "desktop", "mobile"])).min(1),
    expected: z.string().trim().min(1),
  }).strict()).min(9),
}).strict();
