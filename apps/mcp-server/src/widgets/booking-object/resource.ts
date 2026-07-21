import { createHash } from "node:crypto";

import type { OAuthEnvironment } from "@comvenio/auth";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { EVENT_CALENDAR_WIDGET_CSP, eventCalendarWidgetOrigin } from "../event-calendar/resource.ts";
import { BOOKING_OBJECT_WIDGET_CLIENT } from "./client.ts";
import { BOOKING_OBJECT_WIDGET_CSS } from "./styles.ts";

export const BOOKING_OBJECT_WIDGET_RESOURCE_URI = "ui://comvenio/booking-object" as const;
export const BOOKING_OBJECT_WIDGET_MIME_TYPE = "text/html;profile=mcp-app" as const;
export const BOOKING_OBJECT_WIDGET_CLIENT_HASH = createHash("sha256").update(BOOKING_OBJECT_WIDGET_CLIENT, "utf8").digest("hex");
export const BOOKING_OBJECT_WIDGET_ASSET_PATH = `/widgets/booking-object/assets/booking-object.${BOOKING_OBJECT_WIDGET_CLIENT_HASH}.js` as const;

export function bookingObjectWidgetHtml(environment: OAuthEnvironment): string {
  const origin = eventCalendarWidgetOrigin(environment);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Comvenio Objekte &amp; Buchungen</title><style>${BOOKING_OBJECT_WIDGET_CSS}</style></head><body><div id="app"><main class="page"><section class="widget state-panel" role="status"><h2>Buchungsansicht wird geladen</h2><p>Comvenio lädt nur die für dich freigegebenen Objekte und Verfügbarkeiten.</p></section></main></div><script src="${origin}${BOOKING_OBJECT_WIDGET_ASSET_PATH}" defer></script></body></html>`;
}

export function bookingObjectWidgetUiMetadata(environment: OAuthEnvironment) {
  const origin = eventCalendarWidgetOrigin(environment);
  return { ui: { resourceUri: BOOKING_OBJECT_WIDGET_RESOURCE_URI, prefersBorder: true, csp: { connectDomains: [origin], resourceDomains: [origin] }, domain: origin } } as const;
}

export function bookingObjectToolMetadata(environment: OAuthEnvironment) {
  return { _meta: bookingObjectWidgetUiMetadata(environment) } as const;
}

export function registerBookingObjectWidgetResource(server: McpServer, environment: OAuthEnvironment): void {
  const metadata = bookingObjectWidgetUiMetadata(environment);
  server.registerResource("comvenio-booking-object", BOOKING_OBJECT_WIDGET_RESOURCE_URI, {
    title: "Comvenio Objekte & Buchungen",
    description: "Berechtigungsgebundene Objektverfügbarkeit mit sicherem Reservierungs-Vorschauflow.",
    mimeType: BOOKING_OBJECT_WIDGET_MIME_TYPE,
    _meta: metadata,
  }, async () => ({ contents: [{ uri: BOOKING_OBJECT_WIDGET_RESOURCE_URI, mimeType: BOOKING_OBJECT_WIDGET_MIME_TYPE, text: bookingObjectWidgetHtml(environment), _meta: metadata }] }));
}

export { EVENT_CALENDAR_WIDGET_CSP as BOOKING_OBJECT_WIDGET_CSP };
