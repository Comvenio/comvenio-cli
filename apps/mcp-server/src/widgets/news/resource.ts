import { createHash } from "node:crypto";
import type { OAuthEnvironment } from "@comvenio/auth";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EVENT_CALENDAR_WIDGET_CSP, eventCalendarWidgetOrigin } from "../event-calendar/resource.ts";
import { NEWS_WIDGET_CLIENT } from "./client.ts";
import { NEWS_WIDGET_CSS } from "./styles.ts";

export const NEWS_WIDGET_RESOURCE_URI = "ui://comvenio/news" as const;
export const NEWS_WIDGET_MIME_TYPE = "text/html;profile=mcp-app" as const;
export const NEWS_WIDGET_CLIENT_HASH = createHash("sha256").update(NEWS_WIDGET_CLIENT, "utf8").digest("hex");
export const NEWS_WIDGET_ASSET_PATH = `/widgets/news/assets/news.${NEWS_WIDGET_CLIENT_HASH}.js` as const;
export function newsWidgetHtml(environment: OAuthEnvironment): string { const origin = eventCalendarWidgetOrigin(environment); return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Comvenio News</title><style>${NEWS_WIDGET_CSS}</style></head><body><div id="app"><main class="page"><section class="widget state-panel" role="status"><h2>News werden geladen</h2><p>Comvenio lädt nur veröffentlichte oder für dich freigegebene Beiträge.</p></section></main></div><script src="${origin}${NEWS_WIDGET_ASSET_PATH}" defer></script></body></html>`; }
export function newsWidgetUiMetadata(environment: OAuthEnvironment) { const origin = eventCalendarWidgetOrigin(environment); return { ui: { resourceUri: NEWS_WIDGET_RESOURCE_URI, prefersBorder: true, csp: { connectDomains: [origin], resourceDomains: [origin] }, domain: origin } } as const; }
export function newsToolMetadata(environment: OAuthEnvironment) { return { _meta: newsWidgetUiMetadata(environment) } as const; }
export function registerNewsWidgetResource(server: McpServer, environment: OAuthEnvironment): void { const metadata = newsWidgetUiMetadata(environment); server.registerResource("comvenio-news", NEWS_WIDGET_RESOURCE_URI, { title: "Comvenio News", description: "Öffentlicher Newsfeed und berechtigte Vorschau-/Publikationsintents.", mimeType: NEWS_WIDGET_MIME_TYPE, _meta: metadata }, async () => ({ contents: [{ uri: NEWS_WIDGET_RESOURCE_URI, mimeType: NEWS_WIDGET_MIME_TYPE, text: newsWidgetHtml(environment), _meta: metadata }] })); }
export { EVENT_CALENDAR_WIDGET_CSP as NEWS_WIDGET_CSP };
