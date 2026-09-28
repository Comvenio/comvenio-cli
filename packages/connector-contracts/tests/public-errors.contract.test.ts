import { describe, expect, test } from "bun:test";

import {
  CONNECTOR_ERROR_CODES,
  PUBLIC_ERROR_CATALOG,
  formatPublicError,
  publicErrorCode,
  renderPublicError,
  resolvePublicErrorLang,
} from "@comvenio/connector-contracts";

// Customer texts must not reveal how Comvenio runs inside (DC-4, TC-05).
const INTERNAL_DETAIL = /(-service\b|\/api\/|https?:|localhost|railway|gateway|\.tsx?\b|\.py\b|postgres|redis|\bmcp\b|stack|trace)/iu;

describe("public error catalog (01-fehlermodell)", () => {
  test("TC-02: every internal connector code has a public entry in German and English", () => {
    for (const code of CONNECTOR_ERROR_CODES) {
      const entry = PUBLIC_ERROR_CATALOG[code];
      expect(entry, code).toBeDefined();
      expect(publicErrorCode({ code, retryable: true })).toBe(code);
    }
  });

  test("TC-02: every entry is complete and bilingual", () => {
    for (const [code, entry] of Object.entries(PUBLIC_ERROR_CATALOG)) {
      expect(code).toMatch(/^[A-Z][A-Z_]+$/u);
      for (const lang of ["de", "en"] as const) {
        expect(entry[lang].message.trim().length, `${code}.${lang}.message`).toBeGreaterThan(0);
        expect(entry[lang].cause.trim().length, `${code}.${lang}.cause`).toBeGreaterThan(0);
      }
      expect(entry.help).toBe(`fehler/${code.toLowerCase().replaceAll("_", "-")}`);
      if (entry.next_command !== null) expect(entry.next_command).toStartWith("comvenio ");
    }
  });

  test("TC-05: no customer text names internal paths, services or operations", () => {
    for (const [code, entry] of Object.entries(PUBLIC_ERROR_CATALOG)) {
      const texts = [entry.de.message, entry.de.cause, entry.en.message, entry.en.cause, entry.next_command ?? ""];
      for (const text of texts) expect(text, code).not.toMatch(INTERNAL_DETAIL);
    }
  });

  test("TC-03: an unknown code falls back to UNKNOWN_ERROR with request ID and a bug-report hint", () => {
    const code = publicErrorCode({ code: "SOMETHING_NEW" });
    expect(code).toBe("UNKNOWN_ERROR");
    const rendered = renderPublicError({ code, lang: "de", request_id: "11111111-1111-4111-8111-111111111111" });
    expect(rendered.message.length).toBeGreaterThan(0);
    expect(rendered.cause).toContain("Fehlerbericht");
    expect(formatPublicError(rendered)).toContain("Anfrage-ID: 11111111-1111-4111-8111-111111111111");
  });

  test("TC-04: --lang wins, then LC_ALL/LANG, otherwise German", () => {
    expect(resolvePublicErrorLang("en", { LANG: "de_DE.UTF-8" })).toBe("en");
    expect(resolvePublicErrorLang(undefined, { LANG: "en_US.UTF-8" })).toBe("en");
    expect(resolvePublicErrorLang(undefined, { LC_ALL: "de_AT.UTF-8", LANG: "en_US.UTF-8" })).toBe("de");
    expect(resolvePublicErrorLang(undefined, { LANG: "C.UTF-8" })).toBe("de");
    expect(resolvePublicErrorLang(undefined, {})).toBe("de");
    expect(resolvePublicErrorLang("fr", { LANG: "en_US.UTF-8" })).toBe("de");
    const en = renderPublicError({ code: "PERMISSION_DENIED", lang: "en" });
    expect(en.message).toBe(PUBLIC_ERROR_CATALOG.PERMISSION_DENIED!.en.message);
    expect(formatPublicError(en)).toStartWith("Error PERMISSION_DENIED:");
  });

  test("TC-01: a missing scope names every scope and builds one login command", () => {
    const rendered = renderPublicError({
      code: "SCOPE_REQUIRED",
      lang: "de",
      required_scopes: ["club.write", "admin.write"],
      granted_scopes: ["club.read", "role.read.self"],
    });
    expect(rendered.cause).toContain("admin.write, club.write");
    expect(rendered.next_command).toBe("comvenio login --scopes admin.write,club.read,club.write,role.read.self");
    const text = formatPublicError(rendered);
    expect(text).toStartWith("Fehler SCOPE_REQUIRED:");
    expect(text).toContain("→ comvenio login --scopes");
    expect(text).toContain("Mehr: comvenio help fehler SCOPE_REQUIRED");
  });

  test("SCOPE_REQUIRED without known scopes falls back to a full login", () => {
    const rendered = renderPublicError({ code: "SCOPE_REQUIRED", lang: "en" });
    expect(rendered.next_command).toBe("comvenio login");
    expect(rendered.cause).not.toContain("{");
  });

  test("a write that ran into the time limit is OUTCOME_UNKNOWN, a read stays a timeout", () => {
    expect(publicErrorCode({ code: "UPSTREAM_TIMEOUT", retryable: false })).toBe("OUTCOME_UNKNOWN");
    expect(publicErrorCode({ code: "UPSTREAM_TIMEOUT", retryable: true })).toBe("UPSTREAM_TIMEOUT");
    const rendered = renderPublicError({ code: "OUTCOME_UNKNOWN", lang: "de" });
    expect(rendered.cause).toContain("Stand prüfen statt wiederholen");
  });
});
