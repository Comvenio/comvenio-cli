import { createHash } from "node:crypto";

import { oauthEndpoints, type HttpsUrl, type OAuthEnvironment } from "@comvenio/auth";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { EVENT_CALENDAR_WIDGET_CLIENT } from "./client.ts";
import { EVENT_CALENDAR_WIDGET_CSS } from "./styles.ts";

export const EVENT_CALENDAR_WIDGET_RESOURCE_URI = "ui://comvenio/event-calendar" as const;
export const EVENT_CALENDAR_WIDGET_MIME_TYPE = "text/html;profile=mcp-app" as const;
export const EVENT_CALENDAR_WIDGET_CLIENT_HASH = createHash("sha256")
  .update(EVENT_CALENDAR_WIDGET_CLIENT, "utf8")
  .digest("hex");
export const EVENT_CALENDAR_WIDGET_ASSET_PATH = `/widgets/event-calendar/assets/event-calendar.${EVENT_CALENDAR_WIDGET_CLIENT_HASH}.js` as const;

export const EVENT_CALENDAR_WIDGET_CSP = "default-src 'none'; script-src 'self'; img-src https:; style-src 'self' 'unsafe-inline'; connect-src https://comvenio-cli-production.up.railway.app https://mcpdev.comvenio.app; font-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'" as const;

export function eventCalendarWidgetOrigin(environment: OAuthEnvironment): HttpsUrl {
  return oauthEndpoints(environment).resource;
}

export function eventCalendarWidgetHtml(environment: OAuthEnvironment): string {
  const origin = eventCalendarWidgetOrigin(environment);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Comvenio Event &amp; Kalender</title><style>${EVENT_CALENDAR_WIDGET_CSS}</style></head><body><div id="app"><main class="page"><section class="widget state-panel" role="status"><h2>Kalender wird geladen</h2><p>Comvenio lädt die für dich freigegebenen Termine.</p></section></main></div><script src="${origin}${EVENT_CALENDAR_WIDGET_ASSET_PATH}" defer></script></body></html>`;
}

export function eventCalendarWidgetUiMetadata(environment: OAuthEnvironment) {
  const origin = eventCalendarWidgetOrigin(environment);
  return {
    ui: {
      resourceUri: EVENT_CALENDAR_WIDGET_RESOURCE_URI,
      prefersBorder: true,
      csp: {
        connectDomains: [origin],
        resourceDomains: [origin],
      },
      domain: origin,
    },
  } as const;
}

export function eventCalendarToolMetadata(environment: OAuthEnvironment): { _meta: ReturnType<typeof eventCalendarWidgetUiMetadata> } {
  return { _meta: eventCalendarWidgetUiMetadata(environment) };
}

export function registerEventCalendarWidgetResource(server: McpServer, environment: OAuthEnvironment): void {
  const metadata = eventCalendarWidgetUiMetadata(environment);
  server.registerResource(
    "comvenio-event-calendar",
    EVENT_CALENDAR_WIDGET_RESOURCE_URI,
    {
      title: "Comvenio Event & Kalender",
      description: "Responsive Agenda und Kalenderansicht für öffentliche oder berechtigte Vereinstermine.",
      mimeType: EVENT_CALENDAR_WIDGET_MIME_TYPE,
      _meta: metadata,
    },
    async () => ({
      contents: [{
        uri: EVENT_CALENDAR_WIDGET_RESOURCE_URI,
        mimeType: EVENT_CALENDAR_WIDGET_MIME_TYPE,
        text: eventCalendarWidgetHtml(environment),
        _meta: metadata,
      }],
    }),
  );
}
