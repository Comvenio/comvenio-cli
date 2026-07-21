import { createHash } from "node:crypto";

import type { OAuthEnvironment } from "@comvenio/auth";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { EVENT_CALENDAR_WIDGET_CSP, eventCalendarWidgetOrigin } from "../event-calendar/resource.ts";
import { MEMBER_MANAGEMENT_WIDGET_CLIENT } from "./client.ts";
import { MEMBER_MANAGEMENT_WIDGET_CSS } from "./styles.ts";

export const MEMBER_MANAGEMENT_WIDGET_RESOURCE_URI = "ui://comvenio/member-management" as const;
export const MEMBER_MANAGEMENT_WIDGET_MIME_TYPE = "text/html;profile=mcp-app" as const;
export const MEMBER_MANAGEMENT_WIDGET_CLIENT_HASH = createHash("sha256").update(MEMBER_MANAGEMENT_WIDGET_CLIENT, "utf8").digest("hex");
export const MEMBER_MANAGEMENT_WIDGET_ASSET_PATH = `/widgets/member-management/assets/member-management.${MEMBER_MANAGEMENT_WIDGET_CLIENT_HASH}.js` as const;

export function memberManagementWidgetHtml(environment: OAuthEnvironment): string {
  const origin = eventCalendarWidgetOrigin(environment);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Comvenio Mitgliederverwaltung</title><style>${MEMBER_MANAGEMENT_WIDGET_CSS}</style></head><body><div id="app"><main class="page"><section class="widget state-panel" role="status"><h2>Mitglieder werden geladen</h2><p>Comvenio lädt ausschließlich die für dich freigegebenen Mitgliedsdaten.</p></section></main></div><script src="${origin}${MEMBER_MANAGEMENT_WIDGET_ASSET_PATH}" defer></script></body></html>`;
}

export function memberManagementWidgetUiMetadata(environment: OAuthEnvironment) {
  const origin = eventCalendarWidgetOrigin(environment);
  return { ui: { resourceUri: MEMBER_MANAGEMENT_WIDGET_RESOURCE_URI, prefersBorder: true, csp: { connectDomains: [origin], resourceDomains: [origin] }, domain: origin } } as const;
}

export function memberManagementToolMetadata(environment: OAuthEnvironment) {
  return { _meta: memberManagementWidgetUiMetadata(environment) } as const;
}

export function registerMemberManagementWidgetResource(server: McpServer, environment: OAuthEnvironment): void {
  const metadata = memberManagementWidgetUiMetadata(environment);
  server.registerResource("comvenio-member-management", MEMBER_MANAGEMENT_WIDGET_RESOURCE_URI, {
    title: "Comvenio Mitgliederverwaltung",
    description: "Datensparsame Mitgliederliste mit explizit geladenen, berechtigten Details.",
    mimeType: MEMBER_MANAGEMENT_WIDGET_MIME_TYPE,
    _meta: metadata,
  }, async () => ({ contents: [{ uri: MEMBER_MANAGEMENT_WIDGET_RESOURCE_URI, mimeType: MEMBER_MANAGEMENT_WIDGET_MIME_TYPE, text: memberManagementWidgetHtml(environment), _meta: metadata }] }));
}

export { EVENT_CALENDAR_WIDGET_CSP as MEMBER_MANAGEMENT_WIDGET_CSP };
