import type { OAuthEnvironment } from "@comvenio/auth";
import type { Express } from "express";

import { EVENT_CALENDAR_WIDGET_CLIENT } from "./client.ts";
import {
  EVENT_CALENDAR_WIDGET_ASSET_PATH,
  EVENT_CALENDAR_WIDGET_CSP,
  eventCalendarWidgetOrigin,
} from "./resource.ts";

export function mountEventCalendarWidgetAssets(app: Express, environment: OAuthEnvironment): void {
  const origin = eventCalendarWidgetOrigin(environment);
  app.get(EVENT_CALENDAR_WIDGET_ASSET_PATH, (_request, response) => {
    response.setHeader("cache-control", "public, max-age=31536000, immutable");
    response.setHeader("content-security-policy", EVENT_CALENDAR_WIDGET_CSP);
    response.setHeader("cross-origin-resource-policy", "same-origin");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("access-control-allow-origin", origin);
    response.type("application/javascript; charset=utf-8").status(200).send(EVENT_CALENDAR_WIDGET_CLIENT);
  });
}
