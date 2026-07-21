import { describe, expect, test } from "bun:test";

import {
  createConnectorError,
  createProviderNeutralResult,
  isConnectorError,
  normalizeRequestContext,
  type RequestContext,
} from "@comvenio/connector-contracts";

const cliContext: RequestContext = {
  request_id: "11111111-1111-4111-8111-111111111111",
  surface: "cli",
  provider: null,
  subject_id: "22222222-2222-4222-8222-222222222222",
  oauth_grant_id: null,
  club_id: "33333333-3333-4333-8333-333333333333",
  department_id: null,
  scopes: ["club.read", "public.read", "club.read"],
  capability_version: "cap-v1",
  locale: "de-DE",
  timezone: "Europe/Berlin",
};

describe("RequestContext contract", () => {
  test("recognizes only errors created by the connector contract", () => {
    const connectorError = createConnectorError({
      code: "PERMISSION_DENIED",
      message: "Nicht erlaubt.",
      request_id: cliContext.request_id,
      retryable: false,
    });
    const spoofedError = Object.assign(new Error("private upstream detail"), {
      name: "ConnectorError",
      code: "PERMISSION_DENIED",
      request_id: cliContext.request_id,
      retryable: false,
    });

    expect(isConnectorError(connectorError)).toBe(true);
    expect(isConnectorError(spoofedError)).toBe(false);
  });

  test("normalizes the CLI surface without an AI provider", () => {
    const normalized = normalizeRequestContext(cliContext);
    expect(normalized.surface).toBe("cli");
    expect(normalized.provider).toBeNull();
    expect(normalized.club_id).toBe(cliContext.club_id);
    expect(normalized.scopes).toEqual(["club.read", "public.read"]);
  });

  test("accepts MCP contexts only with a supported provider", () => {
    const normalized = normalizeRequestContext({
      ...cliContext,
      surface: "mcp",
      provider: "openai",
      oauth_grant_id: "44444444-4444-4444-8444-444444444444",
    });
    expect(normalized.surface).toBe("mcp");
    expect(normalized.provider).toBe("openai");
  });

  test("fails closed for invalid surface and provider combinations", () => {
    try {
      normalizeRequestContext({ ...cliContext, provider: "anthropic" });
      throw new Error("Expected the invalid context to fail");
    } catch (error) {
      expect(isConnectorError(error)).toBe(true);
      if (isConnectorError(error)) expect(error.code).toBe("CONFIG_INVALID");
    }

    expect(() => normalizeRequestContext({
      ...cliContext,
      surface: "mcp",
      provider: null,
    })).toThrow();

    expect(() => normalizeRequestContext({
      ...cliContext,
      surface: "desktop" as RequestContext["surface"],
    })).toThrow();

    expect(() => normalizeRequestContext({
      ...cliContext,
      surface: "mcp",
      provider: "unknown" as RequestContext["provider"],
    })).toThrow();
  });

  test("fails closed for invalid locale, timezone, UUIDs and scopes", () => {
    expect(() => normalizeRequestContext({
      ...cliContext,
      locale: "en-US" as RequestContext["locale"],
    })).toThrow();
    expect(() => normalizeRequestContext({
      ...cliContext,
      timezone: "not/a-timezone",
    })).toThrow();
    expect(() => normalizeRequestContext({
      ...cliContext,
      club_id: "not-a-uuid",
    })).toThrow();
    expect(() => normalizeRequestContext({
      ...cliContext,
      scopes: ["unknown.read" as RequestContext["scopes"][number]],
    })).toThrow();
  });

  test("creates provider-neutral metadata without request payloads", () => {
    const result = createProviderNeutralResult(cliContext, { status: "ok" });
    expect(result).toEqual({
      content: [],
      structuredContent: { status: "ok" },
      _meta: {
        request_id: cliContext.request_id,
        capability_version: "cap-v1",
      },
    });
  });
});
