import type { OAuthEnvironment } from "@comvenio/auth";
import type { Express } from "express";

import { sendPublicWidgetJavascript } from "../shared/assets.ts";
import { EVENT_CALENDAR_WIDGET_CLIENT } from "./client.ts";
import {
  EVENT_CALENDAR_WIDGET_ASSET_PATH,
  EVENT_CALENDAR_WIDGET_CSP,
} from "./resource.ts";

export function mountEventCalendarWidgetAssets(app: Express, _environment: OAuthEnvironment): void {
  app.get(EVENT_CALENDAR_WIDGET_ASSET_PATH, (_request, response) => {
    sendPublicWidgetJavascript({
      response,
      content_security_policy: EVENT_CALENDAR_WIDGET_CSP,
      source: EVENT_CALENDAR_WIDGET_CLIENT,
    });
  });
}
