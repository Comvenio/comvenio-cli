import { createHash } from "node:crypto";
import type { OAuthEnvironment } from "@comvenio/auth";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EVENT_CALENDAR_WIDGET_CSP, eventCalendarWidgetOrigin } from "../event-calendar/resource.ts";
import { CONFIRMATION_WIDGET_CLIENT } from "./client.ts";
import { CONFIRMATION_WIDGET_CSS } from "./styles.ts";
export const CONFIRMATION_WIDGET_RESOURCE_URI = "ui://comvenio/action-confirmation" as const;
export const CONFIRMATION_WIDGET_MIME_TYPE = "text/html;profile=mcp-app" as const;
export const CONFIRMATION_WIDGET_CLIENT_HASH = createHash("sha256").update(CONFIRMATION_WIDGET_CLIENT, "utf8").digest("hex");
export const CONFIRMATION_WIDGET_ASSET_PATH = `/widgets/action-confirmation/assets/action-confirmation.${CONFIRMATION_WIDGET_CLIENT_HASH}.js` as const;
export function confirmationWidgetHtml(environment: OAuthEnvironment): string { const origin=eventCalendarWidgetOrigin(environment); return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Comvenio Aktionsbestätigung</title><style>${CONFIRMATION_WIDGET_CSS}</style></head><body><div id="app"><main class="overlay-demo"><section class="dialog-host"><article class="confirm-sheet" role="status"><h2>Vorschau wird geladen</h2><p>Comvenio lädt die aktuelle, serverseitig gebundene Wirkungsvorschau.</p></article></section></main></div><script src="${origin}${CONFIRMATION_WIDGET_ASSET_PATH}" defer></script></body></html>`; }
export function confirmationWidgetUiMetadata(environment: OAuthEnvironment) { const origin=eventCalendarWidgetOrigin(environment); return { ui:{ resourceUri:CONFIRMATION_WIDGET_RESOURCE_URI,prefersBorder:false,csp:{connectDomains:[origin],resourceDomains:[origin]},domain:origin } } as const; }
export function confirmationToolMetadata(environment: OAuthEnvironment) { return {_meta:confirmationWidgetUiMetadata(environment)} as const; }
export function confirmationActionToolMetadata() {
  return { _meta: { ui: { visibility: ["app"] as const } } } as const;
}
export function registerConfirmationWidgetResource(server:McpServer,environment:OAuthEnvironment):void { const metadata=confirmationWidgetUiMetadata(environment); server.registerResource("comvenio-action-confirmation",CONFIRMATION_WIDGET_RESOURCE_URI,{title:"Comvenio Aktionsbestätigung",description:"Gebundene, maskierte Wirkungsvorschau für genau eine kritische Aktion.",mimeType:CONFIRMATION_WIDGET_MIME_TYPE,_meta:metadata},async()=>({contents:[{uri:CONFIRMATION_WIDGET_RESOURCE_URI,mimeType:CONFIRMATION_WIDGET_MIME_TYPE,text:confirmationWidgetHtml(environment),_meta:metadata}]})); }
export { EVENT_CALENDAR_WIDGET_CSP as CONFIRMATION_WIDGET_CSP };
