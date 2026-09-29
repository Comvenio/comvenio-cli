import { describe, expect, test } from "bun:test";

import { AuthError, LoginOptionError } from "../src/auth.ts";
import {
  PublicCliError,
  cleanDetail,
  formatCliError,
  langArgument,
  resolveCliLang,
  toPublicError,
} from "../src/errors.ts";
import { unknownCommandError } from "../src/commands/removed.ts";
import { ConnectorClientError } from "../src/mcp/client.ts";

const requestId = "11111111-1111-4111-8111-111111111111";

describe("CLI customer errors (01-fehlermodell)", () => {
  test("TC-01: SCOPE_REQUIRED shows code, cause, the login command with all scopes and the help pointer", () => {
    const error = new ConnectorClientError("Fehler SCOPE_REQUIRED: …", {
      error: "insufficient_scope",
      code: "SCOPE_REQUIRED",
      required_scopes: ["admin.write"],
      request_id: requestId,
    });
    const rendered = toPublicError(error, { lang: "de", granted_scopes: ["club.read", "role.read.self"] });
    expect(rendered).toMatchObject({
      code: "SCOPE_REQUIRED",
      next_command: "comvenio login --scopes admin.write,club.read,role.read.self",
      help: "fehler/scope-required",
      request_id: requestId,
      lang: "de",
    });
    const lines = formatCliError(rendered).split("\n");
    expect(lines[0]).toStartWith("Fehler SCOPE_REQUIRED: ");
    expect(lines[0]).toContain("admin.write");
    expect(lines[1]).toBe("→ comvenio login --scopes admin.write,club.read,role.read.self");
    expect(lines[2]).toBe("Mehr: comvenio help fehler SCOPE_REQUIRED");
    expect(formatCliError(rendered)).not.toContain("nicht verfügbar");
  });

  test("an older connector answer with only the internal code still maps", () => {
    const rendered = toPublicError(
      new ConnectorClientError("x", { error: "insufficient_scope", required_scopes: ["club.write"] }),
      { lang: "en", granted_scopes: [] },
    );
    expect(rendered.code).toBe("SCOPE_REQUIRED");
    expect(rendered.next_command).toBe("comvenio login --scopes club.write");
    const permission = toPublicError(new ConnectorClientError("x", { error: "permission_denied" }), { lang: "de" });
    expect(permission.code).toBe("PERMISSION_DENIED");
  });

  test("an older JSON-RPC error with a write timeout still becomes OUTCOME_UNKNOWN", () => {
    const rendered = toPublicError(
      new ConnectorClientError("x", { code: "UPSTREAM_TIMEOUT", retryable: false }),
      { lang: "de" },
    );
    expect(rendered.code).toBe("OUTCOME_UNKNOWN");
  });

  test("JSON shape matches the contract", () => {
    const rendered = toPublicError(new PublicCliError("ACTION_NOT_LISTED", "nicht freigegeben"), { lang: "de" });
    expect(Object.keys(rendered).sort()).toEqual(
      ["cause", "code", "help", "lang", "message", "next_command", "request_id"],
    );
    expect(rendered.next_command).toBe("comvenio action list");
  });

  test("a removed classic command is USAGE_ERROR with a pointer to action list (geraetetoken-abbau-04 DC-3)", () => {
    const rendered = toPublicError(unknownCommandError("member"), { lang: "de" });
    expect(rendered.code).toBe("USAGE_ERROR");
    expect(rendered.detail).toContain("„comvenio member“ gibt es im CLI nicht mehr.");
    expect(rendered.detail).toContain("comvenio action list");
  });

  test("TC-03: an unexpected error is UNKNOWN_ERROR with an ID and without its internal text", () => {
    const rendered = toPublicError(new TypeError("x is undefined at /srv/app/src/x.ts"), { lang: "de" });
    expect(rendered.code).toBe("UNKNOWN_ERROR");
    expect(rendered.request_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(rendered.detail).toBeUndefined();
    expect(formatCliError(rendered)).not.toContain("x.ts");
    expect(rendered.cause).toContain("Fehlerbericht");
    const unknownConnector = toPublicError(new ConnectorClientError("neu", { error: "brand_new" }), { lang: "de" });
    expect(unknownConnector.code).toBe("UNKNOWN_ERROR");
    expect(unknownConnector.request_id).not.toBeNull();
  });

  test("a multi-line detail is indented line by line", () => {
    const lines = formatCliError(toPublicError(new AuthError("eins\nzwei"), { lang: "de" })).split("\n");
    expect(lines.slice(1, 3)).toEqual(["  eins", "  zwei"]);
  });

  test("TC-05: a detail line never shows the home directory or a URL", () => {
    expect(cleanDetail("State-File nicht gefunden: /Users/kim/.comvenio-cli-state.json", "/Users/kim"))
      .toBe("State-File nicht gefunden: ~/.comvenio-cli-state.json");
    expect(cleanDetail("siehe https://api.comvenio.app/club-service/x jetzt", "/Users/kim")).toBe("siehe <URL> jetzt");
    expect(cleanDetail("Keine Download-URL vom content-service erhalten.", "/Users/kim"))
      .toBe("Keine Download-URL von Comvenio erhalten.");
  });

  test("argument errors are USAGE_ERROR; only wrong login options, not every sign-in problem", () => {
    expect(toPublicError(new Error("--file und --input …"), { lang: "de" }).code).toBe("USAGE_ERROR");
    expect(toPublicError(new AuthError("abgelaufen"), { lang: "de" }).code).toBe("AUTH_REQUIRED");
    expect(toPublicError(new LoginOptionError("Ungültige Umgebung"), { lang: "de" }).code).toBe("USAGE_ERROR");
  });

  test("a tool detail from the connector is shown under the catalog sentence", () => {
    const rendered = toPublicError(new ConnectorClientError("x", {
      error: "validation_failed",
      code: "VALIDATION_FAILED",
      detail: "Der Erinnerungszeitpunkt muss in der Zukunft liegen.",
    }), { lang: "de" });
    expect(formatCliError(rendered).split("\n")[1]).toBe("  Der Erinnerungszeitpunkt muss in der Zukunft liegen.");
  });

  test("TC-04: --lang and LANG select English, default is German", () => {
    expect(langArgument(["action", "list", "--lang", "en"])).toBe("en");
    expect(langArgument(["--lang=en"])).toBe("en");
    expect(resolveCliLang(["--lang", "en"], {})).toBe("en");
    expect(resolveCliLang([], { LANG: "en_US.UTF-8" })).toBe("en");
    expect(resolveCliLang([], {})).toBe("de");
    const english = toPublicError(new PublicCliError("ACTION_NOT_LISTED", "x"), { lang: "en" });
    expect(formatCliError(english)).toStartWith("Error ACTION_NOT_LISTED: This action");
    expect(formatCliError(english)).toContain("More: comvenio help fehler ACTION_NOT_LISTED");
  });
});
