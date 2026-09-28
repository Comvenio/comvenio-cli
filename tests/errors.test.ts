import { describe, expect, test } from "bun:test";

import { AuthError } from "../src/auth.ts";
import {
  PublicCliError,
  formatCliError,
  langArgument,
  resolveCliLang,
  toPublicError,
} from "../src/errors.ts";
import { HttpError, OAuthOnlyError } from "../src/http.ts";
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

  test("JSON shape matches the contract", () => {
    const rendered = toPublicError(new PublicCliError("ACTION_NOT_LISTED", "nicht freigegeben"), { lang: "de" });
    expect(Object.keys(rendered).sort()).toEqual(
      ["cause", "code", "help", "lang", "message", "next_command", "request_id"],
    );
    expect(rendered.next_command).toBe("comvenio action list");
  });

  test("classic command under OAuth is OAUTH_ONLY with a pointer to action list", () => {
    const rendered = toPublicError(new OAuthOnlyError("klassisch"), { lang: "de" });
    expect(rendered.code).toBe("OAUTH_ONLY");
    expect(rendered.next_command).toBe("comvenio action list");
  });

  test("TC-03: an unexpected error is UNKNOWN_ERROR and keeps its text as detail", () => {
    const rendered = toPublicError(new TypeError("x is undefined"), { lang: "de" });
    expect(rendered.code).toBe("UNKNOWN_ERROR");
    expect(rendered.detail).toBe("x is undefined");
    expect(rendered.cause).toContain("Fehlerbericht");
    const multiLine = formatCliError(toPublicError(new AuthError("eins\nzwei"), { lang: "de" })).split("\n");
    expect(multiLine.slice(1, 3)).toEqual(["  eins", "  zwei"]);
    const unknownConnector = toPublicError(new ConnectorClientError("neu", { error: "brand_new" }), { lang: "de" });
    expect(unknownConnector.code).toBe("UNKNOWN_ERROR");
  });

  test("argument errors are USAGE_ERROR; auth errors outside login are AUTH_REQUIRED", () => {
    expect(toPublicError(new Error("--file und --input …"), { lang: "de" }).code).toBe("USAGE_ERROR");
    expect(toPublicError(new AuthError("abgelaufen"), { lang: "de" }).code).toBe("AUTH_REQUIRED");
    expect(toPublicError(new AuthError("Ungültige Umgebung"), { lang: "de", command: "login" }).code).toBe("USAGE_ERROR");
  });

  test("HTTP errors of classic commands never show the URL", () => {
    const rendered = toPublicError(new HttpError(404, "{}", "https://api.comvenio.app/club-service/x"), { lang: "de" });
    expect(rendered.code).toBe("NOT_FOUND");
    expect(formatCliError(rendered)).not.toContain("club-service");
  });

  test("TC-04: --lang and LANG select English, default is German", () => {
    expect(langArgument(["action", "list", "--lang", "en"])).toBe("en");
    expect(langArgument(["--lang=en"])).toBe("en");
    expect(resolveCliLang(["--lang", "en"], {})).toBe("en");
    expect(resolveCliLang([], { LANG: "en_US.UTF-8" })).toBe("en");
    expect(resolveCliLang([], {})).toBe("de");
    const english = toPublicError(new OAuthOnlyError("x"), { lang: "en" });
    expect(formatCliError(english)).toStartWith("Error OAUTH_ONLY: This command");
    expect(formatCliError(english)).toContain("More: comvenio help fehler OAUTH_ONLY");
  });
});
