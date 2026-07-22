import type { ChatGptAppManifest } from "./types.ts";
import { CHAT_GPT_APP_MANIFEST_SCHEMA } from "./schemas.ts";

const STARTER_PROMPTS: ChatGptAppManifest["starter_prompts"] = [
  "Welche Termine stehen diese Woche in meinem Verein an?",
  "Zeige mir die neuesten News meines Vereins.",
  "Welche Comvenio-Aktionen darf ich in diesem Verein ausführen?",
];

export function buildChatGptAppManifest(toolCatalogVersion: string): ChatGptAppManifest {
  return CHAT_GPT_APP_MANIFEST_SCHEMA.parse({
    schema_version: "1.0.0",
    product_name: "Comvenio",
    tagline: "Dein Verein. Dein KI-Agent. Direkt im Chat.",
    short_description: "Öffentliche Vereinsinfos, Termine und News abrufen und eigene freigegebene Möglichkeiten sicher verstehen.",
    publisher_name: "Comvenio",
    category: "Productivity",
    website_url: "https://www.comvenio.app",
    privacy_url: "https://www.comvenio.app/datenschutz",
    terms_url: "https://www.comvenio.app/agb",
    imprint_url: "https://www.comvenio.app/impressum",
    support_email: "support@comvenio.de",
    locale: "de-DE",
    mcp_endpoint: "https://comvenio-cli-production.up.railway.app/mcp",
    starter_prompts: STARTER_PROMPTS,
    provider: "openai",
    submission_kind: "plugin_with_mcp_app",
    oauth_protected_resource_url: "https://comvenio-cli-production.up.railway.app/.well-known/oauth-protected-resource",
    support_runbook_url: "https://www.comvenio.app/hilfe",
    widget_resource_uris: [
      "ui://comvenio/event-calendar",
      "ui://comvenio/news",
    ],
    tool_catalog_version: toolCatalogVersion,
    assets: { icon: "./assets/icon.svg", logo: "./assets/logo.png" },
    screenshots: [
      { resource_uri: "ui://comvenio/event-calendar", surface: "mobile", path: "./screenshots/event-mobile.png", synthetic_data_only: true },
      { resource_uri: "ui://comvenio/news", surface: "web", path: "./screenshots/news-desktop.png", synthetic_data_only: true },
    ],
    release_gate: "OPENAI_GLOBAL_RESIDENCY_ACCEPTED",
  });
}
