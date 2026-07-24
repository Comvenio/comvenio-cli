import type { OAuthEnvironment } from "@comvenio/auth";
import type { Express } from "express";

import { EVENT_CALENDAR_WIDGET_CSP } from "../event-calendar/resource.ts";
import { sendPublicWidgetJavascript } from "../shared/assets.ts";
import { MEMBER_MANAGEMENT_WIDGET_CLIENT } from "./client.ts";
import { MEMBER_MANAGEMENT_WIDGET_ASSET_PATH } from "./resource.ts";

export function mountMemberManagementWidgetAssets(app: Express, _environment: OAuthEnvironment): void {
  app.get(MEMBER_MANAGEMENT_WIDGET_ASSET_PATH, (_request, response) => {
    sendPublicWidgetJavascript({
      response,
      content_security_policy: EVENT_CALENDAR_WIDGET_CSP,
      source: MEMBER_MANAGEMENT_WIDGET_CLIENT,
    });
  });
}
