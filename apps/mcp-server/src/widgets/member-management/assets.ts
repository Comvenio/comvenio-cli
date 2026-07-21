import type { OAuthEnvironment } from "@comvenio/auth";
import type { Express } from "express";

import { EVENT_CALENDAR_WIDGET_CSP, eventCalendarWidgetOrigin } from "../event-calendar/resource.ts";
import { MEMBER_MANAGEMENT_WIDGET_CLIENT } from "./client.ts";
import { MEMBER_MANAGEMENT_WIDGET_ASSET_PATH } from "./resource.ts";

export function mountMemberManagementWidgetAssets(app: Express, environment: OAuthEnvironment): void {
  const origin = eventCalendarWidgetOrigin(environment);
  app.get(MEMBER_MANAGEMENT_WIDGET_ASSET_PATH, (_request, response) => {
    response.setHeader("cache-control", "public, max-age=31536000, immutable");
    response.setHeader("content-security-policy", EVENT_CALENDAR_WIDGET_CSP);
    response.setHeader("cross-origin-resource-policy", "same-origin");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("access-control-allow-origin", origin);
    response.type("application/javascript; charset=utf-8").status(200).send(MEMBER_MANAGEMENT_WIDGET_CLIENT);
  });
}
