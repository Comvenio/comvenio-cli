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
const standardToolVerifications = z.tuple([
  z.literal("schema"),
  z.literal("security_schemes"),
  z.literal("annotations"),
  z.literal("rbac_recheck"),
]);
const oauthBoundToolVerifications = z.tuple([
  z.literal("schema"),
  z.literal("security_schemes"),
  z.literal("annotations"),
  z.literal("rbac_recheck"),
  z.literal("oauth_bound_club_discovery"),
]);

export const CHAT_GPT_APP_MANIFEST_SCHEMA = z.object({
  schema_version: z.literal("1.0.0"),
  product_name: z.literal("Comvenio"),
  tagline: z.literal("Dein Verein. Dein KI-Agent. Direkt im Chat."),
  short_description: z.literal("Öffentliche Vereinsinfos, Termine und News abrufen sowie eigene Aufgaben und Erinnerungen sicher verwalten."),
  publisher_name: z.literal("Comvenio"),
  category: z.literal("Productivity"),
  website_url: httpsUrl.pipe(z.literal("https://www.comvenio.app")),
  privacy_url: httpsUrl.pipe(z.literal("https://www.comvenio.app/datenschutz")),
  terms_url: httpsUrl.pipe(z.literal("https://www.comvenio.app/agb")),
  imprint_url: httpsUrl.pipe(z.literal("https://www.comvenio.app/impressum")),
  support_email: z.literal("support@comvenio.de"),
  locale: z.literal("de-DE"),
  mcp_endpoint: httpsUrl.pipe(z.literal("https://mcp.comvenio.app/mcp")),
  starter_prompts: z.tuple([
    z.literal("Welche Termine stehen diese Woche in meinem Verein an?"),
    z.literal("Zeige mir die neuesten News meines Vereins."),
    z.literal("Welche Aufgaben habe ich diese Woche?"),
  ]),
  provider: z.literal("openai"),
  submission_kind: z.literal("plugin_with_mcp_app"),
  oauth_protected_resource_url: httpsUrl.pipe(z.literal("https://mcp.comvenio.app/.well-known/oauth-protected-resource")),
  support_runbook_url: httpsUrl.pipe(z.literal("https://www.comvenio.app/hilfe")),
  widget_resource_uris: z.tuple([
    z.literal("ui://comvenio/event-calendar"),
    z.literal("ui://comvenio/news"),
  ]),
  tool_catalog_version: z.string().regex(/^[a-f0-9]{64}$/u),
  assets: z.object({ icon: z.literal("./assets/icon.svg"), logo: z.literal("./assets/logo.png") }).strict(),
  screenshots: z.array(z.object({ resource_uri: resourceUri, surface: z.enum(["web", "mobile"]), path: localArtifact, synthetic_data_only: z.literal(true) }).strict()).length(2),
  release_gate: z.literal("OPENAI_GLOBAL_RESIDENCY_ACCEPTED"),
}).strict().superRefine((manifest, context) => {
  if (new Set(manifest.widget_resource_uris).size !== 2
    || new Set(manifest.screenshots.map((item) => item.resource_uri)).size !== 2) {
    context.addIssue({ code: "custom", message: "Jede veröffentlichte MCP App benötigt genau einen Screenshot-Nachweis." });
  }
  if (manifest.starter_prompts.some((prompt) => prompt.length > 128)) {
    context.addIssue({ code: "custom", message: "Starter-Prompts dürfen höchstens 128 Zeichen enthalten." });
  }
});

export const OPENAI_TOOL_TEST_PLAN_SCHEMA = z.object({
  schema_version: z.literal("1.0.0"),
  catalog_source_hash_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  coverage: z.literal("every_published_tool"),
  cases: z.array(z.object({
    tool_name: z.string().regex(/^[a-z0-9_.:-]{1,64}$/u),
    prompt: z.string().trim().min(1).max(500),
    expected_response_fixture: z.string().regex(/^fixtures\/provider\/openai\/[a-z0-9_.:-]+\.response\.json$/u),
    required_surfaces: z.tuple([z.literal("web"), z.literal("mobile")]),
    verifies: z.union([standardToolVerifications, oauthBoundToolVerifications]),
  }).strict()),
  submission_examples: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/u),
    polarity: z.enum(["positive", "negative"]),
    prompt: z.string().trim().min(1).max(500),
    expected_behavior: z.string().trim().min(1).max(1_000),
  }).strict()).length(8),
}).strict().superRefine((plan, context) => {
  if (new Set(plan.cases.map((item) => item.tool_name)).size !== plan.cases.length) {
    context.addIssue({ code: "custom", message: "Jedes veröffentlichte Tool darf nur einen Reviewfall besitzen." });
  }
  plan.cases.forEach((item, index) => {
    const verifiesOAuthBoundClubDiscovery = item.verifies.length === 5;
    if (item.tool_name === "public_events" && !verifiesOAuthBoundClubDiscovery) {
      context.addIssue({
        code: "custom",
        path: ["cases", index, "verifies"],
        message: "Der Public-Events-Reviewfall muss die OAuth-gebundene Vereinsermittlung nachweisen.",
      });
    }
    if (item.tool_name !== "public_events" && verifiesOAuthBoundClubDiscovery) {
      context.addIssue({
        code: "custom",
        path: ["cases", index, "verifies"],
        message: "Die OAuth-gebundene Vereinsermittlung ist nur für den Public-Events-Reviewfall freigegeben.",
      });
    }
  });
  if (plan.submission_examples.filter((item) => item.polarity === "positive").length !== 5
    || plan.submission_examples.filter((item) => item.polarity === "negative").length !== 3
    || new Set(plan.submission_examples.map((item) => item.id)).size !== plan.submission_examples.length) {
    context.addIssue({ code: "custom", message: "Die Einreichung benötigt genau fünf positive und drei negative eindeutige Beispiele." });
  }
});

export const OPENAI_REVIEWER_RUNBOOK_SCHEMA = z.object({
  schema_version: z.literal("1.0.0"),
  document_path: z.literal("./submission/reviewer-runbook.md"),
  reviewer_accounts: z.tuple([z.literal("member"), z.literal("manager")]),
  mfa_forbidden: z.literal(true),
  scenarios: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/u), title: z.string().trim().min(1), account_role: z.enum(["anonymous", "member", "manager"]), expected: z.string().trim().min(1) }).strict()).min(8),
}).strict();
