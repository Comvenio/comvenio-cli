import type { Response } from "express";

export function sendPublicWidgetJavascript(input: {
  response: Response;
  content_security_policy: string;
  source: string;
}): void {
  input.response.setHeader(
    "cache-control",
    "public, max-age=31536000, immutable",
  );
  input.response.setHeader(
    "content-security-policy",
    input.content_security_policy,
  );
  input.response.setHeader(
    "cross-origin-resource-policy",
    "cross-origin",
  );
  input.response.setHeader("x-content-type-options", "nosniff");
  input.response.setHeader("access-control-allow-origin", "*");
  input.response
    .type("application/javascript; charset=utf-8")
    .status(200)
    .send(input.source);
}
