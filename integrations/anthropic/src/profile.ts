import { CLAUDE_DIRECTORY_MANIFEST_SCHEMA } from "./schemas.ts";
import type { ClaudeDirectoryManifest } from "./types.ts";

export function buildClaudeDirectoryManifest(toolSyncVersion: string): ClaudeDirectoryManifest {
  return CLAUDE_DIRECTORY_MANIFEST_SCHEMA.parse({
    schema_version: "1.0.0",
    product_name: "Comvenio",
    tagline: "Dein Verein. Dein KI-Agent. Direkt im Chat.",
    short_description: "Öffentliche Vereinsinfos, Termine und News abrufen und eigene freigegebene Möglichkeiten sicher verstehen.",
    publisher_name: "Comvenio",
    categories: ["Productivity"],
    website_url: "https://www.comvenio.app",
    documentation_url: "https://www.comvenio.app/hilfe",
    privacy_url: "https://www.comvenio.app/datenschutz",
    terms_url: "https://www.comvenio.app/agb",
    imprint_url: "https://www.comvenio.app/impressum",
    support_email: "support@comvenio.de",
    locale: "de-DE",
    provider: "anthropic",
    submission_kind: "remote_mcp_with_mcp_apps",
    directory_slug: "comvenio",
    remote_mcp_url: "https://comvenio-cli-production.up.railway.app/mcp",
    transport: "streamable_http",
    oauth_protected_resource_url: "https://comvenio-cli-production.up.railway.app/.well-known/oauth-protected-resource",
    oauth_metadata_url: "https://api.comvenio.app/auth/.well-known/oauth-authorization-server",
    auth: {
      type: "oauth_cimd",
      client_type: "public",
      token_endpoint_auth_method: "none",
      pkce_method: "S256",
      dynamic_client_registration: false,
      anthropic_held_credentials: false,
    },
    capabilities: { tools: true, prompts: false, resources: true, mcp_apps: true },
    allowed_link_uris: [],
    widget_resource_uris: [
      "ui://comvenio/event-calendar",
      "ui://comvenio/news",
    ],
    tool_sync_version: toolSyncVersion,
    assets: { icon: "./assets/icon.svg", logo: "./assets/logo.png" },
    screenshots: [],
  });
}
