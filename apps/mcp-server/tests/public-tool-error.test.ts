import { describe, expect, test } from "bun:test";

import { createConnectorError, type RequestContext } from "@comvenio/connector-contracts";

import { publicToolError } from "../src/public-tool-error.ts";
import { hasWriteAuthority } from "../src/widgets/confirmation/policy.ts";

const context: RequestContext = {
  request_id: "11111111-1111-4111-8111-111111111111",
  surface: "cli",
  provider: null,
  subject_id: "22222222-2222-4222-8222-222222222222",
  oauth_grant_id: "55555555-5555-4555-8555-555555555555",
  club_id: "33333333-3333-4333-8333-333333333333",
  department_id: null,
  scopes: ["club.read", "role.read.self"],
  capability_version: null,
  locale: "de-DE",
  timezone: "Europe/Berlin",
};

const origin = "https://mcp.comvenio.app";

describe("connector customer errors (01-fehlermodell)", () => {
  test("TC-01: a missing write scope is SCOPE_REQUIRED with all scopes, login command and step-up", () => {
    const result = publicToolError(context, origin, createConnectorError({
      code: "SCOPE_REQUIRED",
      message: "Für diese Aktion fehlt der Anmeldung ein Schreib-Scope.",
      request_id: context.request_id,
      retryable: false,
      required_scope: "admin.write",
      required_scopes: ["admin.write"],
    }));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: "insufficient_scope",
      code: "SCOPE_REQUIRED",
      required_scopes: ["admin.write"],
      next_command: "comvenio login --scopes admin.write,club.read,role.read.self",
      help: "fehler/scope-required",
      request_id: context.request_id,
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toStartWith("Fehler SCOPE_REQUIRED:");
    expect(text).not.toContain("nicht verfügbar");
    expect((result._meta as Record<string, string[]>)["mcp/www_authenticate"]![0]).toContain('scope="admin.write"');
  });

  test("PERMISSION_DENIED names the club right as category, not a generic sentence", () => {
    const result = publicToolError(context, origin, createConnectorError({
      code: "PERMISSION_DENIED",
      message: "intern",
      request_id: context.request_id,
      retryable: false,
    }));
    expect(result.structuredContent).toMatchObject({ error: "permission_denied", code: "PERMISSION_DENIED" });
    expect((result.content[0] as { text: string }).text).toContain("Administrator deines Vereins");
  });

  test("TC-03: a foreign error becomes UNKNOWN_ERROR with the request ID", () => {
    const result = publicToolError(context, origin, new TypeError("boom"));
    expect(result.structuredContent).toMatchObject({
      error: "upstream_unavailable",
      code: "UNKNOWN_ERROR",
      request_id: context.request_id,
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain(`Anfrage-ID: ${context.request_id}`);
    expect(text).not.toContain("boom");
  });

  test("a confirmation that timed out upstream says: check the state instead of repeating", () => {
    const result = publicToolError(context, origin, createConnectorError({
      code: "UPSTREAM_TIMEOUT",
      message: "Der Comvenio-Dienst hat nicht rechtzeitig geantwortet.",
      request_id: context.request_id,
      retryable: false,
    }));
    expect(result.structuredContent).toMatchObject({ error: "upstream_timeout", code: "OUTCOME_UNKNOWN" });
    expect((result.content[0] as { text: string }).text).toContain("Stand prüfen statt wiederholen");
  });

  test("write authority needs a writing scope", () => {
    expect(hasWriteAuthority(["club.read", "role.read.self"])).toBe(false);
    expect(hasWriteAuthority(["club.read", "admin.write"])).toBe(true);
    expect(hasWriteAuthority(["files.import"])).toBe(true);
  });
});
