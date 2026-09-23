import { describe, expect, test } from "bun:test";

import { createConnectorError, type JsonValue, type RequestContext } from "@comvenio/connector-contracts";
import type { ComvenioApiClient, ComvenioApiRequest } from "@comvenio/comvenio-client";
import type { CapabilitySnapshot } from "../../../packages/auth/src/index.ts";

import { createK14ToolSet } from "../src/tools/finance/index.ts";

const clubId = "0ec34e70-999a-47c4-a1b1-bdb293110fa5";
const otherClubId = "11111111-1111-4111-8111-111111111111";
const departmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherDepartmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const positionId = "22222222-2222-4222-8222-222222222222";
const entryId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";

// `normalizeRequestContext` prüft jedes Feld: UUID als Request-ID, bekannte
// Oberfläche, Provider nur bei `mcp`, Locale `de-DE`, gültige Zeitzone. Der
// Kontext steht deshalb vollständig da und wird nicht gecastet — ein Cast
// würde genau die Drift verstecken, die diese Tests finden sollen.
const context: RequestContext = {
  request_id: "77777777-7777-4777-8777-777777777777",
  surface: "mcp",
  provider: "anthropic",
  subject_id: actorId,
  oauth_grant_id: "88888888-8888-4888-8888-888888888888",
  club_id: clubId,
  department_id: null,
  scopes: ["finance.read"],
  // Muss gesetzt sein UND zum Snapshot passen, sonst VERSION_STALE.
  capability_version: "test-1",
  locale: "de-DE",
  timezone: "Europe/Berlin",
};
// `manage_finances` und `manage_club_settings` sind die beiden Rechte, die
// `require_club_finance_access` im finance-service prüft.
const capabilitySnapshot: CapabilitySnapshot = {
  member_id: actorId,
  subject_id: actorId,
  club_id: clubId,
  department_ids: [departmentId, otherDepartmentId],
  permissions: { manage_finances: true },
  sources: [],
  capability_version: "test-1",
  generated_at: "2026-09-21T00:00:00Z",
  observed_at: "2026-09-21T00:00:00Z",
  expires_at: "2099-01-01T00:00:00Z",
};
const allowWrites = { async execute(_request: unknown, mutation: () => Promise<JsonValue>) { return mutation(); } };

function client(handler: (request: ComvenioApiRequest) => Promise<JsonValue>): ComvenioApiClient {
  return { timeout_ms: 15_000, async request<T extends JsonValue>(request: ComvenioApiRequest): Promise<T> { return await handler(request) as T; } };
}
function recording(value: JsonValue) {
  const calls: ComvenioApiRequest[] = [];
  return { calls, client: client(async (request) => { calls.push(request); return value; }) };
}
const reader = (scopes: RequestContext["scopes"]) => ({ ...context, scopes });
const manager: CapabilitySnapshot = capabilitySnapshot;

const plan = { id: "55555555-5555-4555-8555-555555555555", club_id: clubId, year: 2026, available_capital_cents: 500_000, status: "ACTIVE", notes: null, closed_by: actorId, closed_at: null, created_at: "2026-01-01T00:00:00Z" };
const entry = { id: entryId, budget_position_id: positionId, club_id: clubId, entry_number: 7, description: "Hallenmiete", revenue_cents: null, expense_cents: 12_000, booking_date: "2026-03-01", source_type: "MANUAL", notes: null, approved_by: actorId, approved_at: "2026-03-02T08:00:00Z", created_by: actorId, created_at: "2026-03-01T09:00:00Z" };

describe("K14 Vereinsbuchhaltung: Mandant und Rechte", () => {
  test("weist einen fremden Verein ab, bevor der Dienst gerufen wird", async () => {
    const { calls, client: adapter } = recording([]);
    const finance = createK14ToolSet({ client: adapter });
    await expect(finance.execute({ action_id: "cai.finance.01.plan_list", input: { club_id: otherClubId }, context: reader(["finance.read"]), capability_snapshot: manager }))
      .rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls.length).toBe(0);
  });

  test("weist eine fremde Abteilung ab, bevor ein Posten entsteht", async () => {
    const { calls, client: adapter } = recording(null);
    const finance = createK14ToolSet({ client: adapter, write_safety: allowWrites });
    await expect(finance.execute({
      action_id: "cai.finance.09.position_create",
      input: { club_id: clubId, department_id: otherDepartmentId, year: 2026, name: "Fremder Posten" },
      context: { ...context, department_id: departmentId, scopes: ["finance.write"] },
      capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls.length).toBe(0);
  });

  // Der Dienst prüft die Rechte des ANFRAGENDEN Menschen, nicht den Verein, den
  // der Connector gewählt hat. Wer in zwei Vereinen Finanzrechte hat, käme ohne
  // diesen Abgleich über eine fremde Kennung an fremde Zahlen.
  test("verwirft eine Antwort, die zu einem anderen Verein gehört", async () => {
    const finance = createK14ToolSet({ client: client(async () => ({ ...plan, club_id: otherClubId })) });
    await expect(finance.execute({ action_id: "cai.finance.02.plan_show", input: { club_id: clubId, year: 2026 }, context: reader(["finance.read"]), capability_snapshot: manager }))
      .rejects.toMatchObject({ code: "TENANT_MISMATCH" });
  });

  // Die Sichtbarkeits-Policy meldet eine abgelaufene Berechtigungsauskunft als
  // VERSION_STALE. Wer das zu PERMISSION_DENIED macht, schickt den Menschen in
  // die Rechteverwaltung, obwohl seine Rechte stimmen.
  test("eine veraltete Berechtigungsauskunft heisst „neu verbinden“, nicht „kein Recht“", async () => {
    const { calls, client: adapter } = recording([]);
    const finance = createK14ToolSet({ client: adapter });
    await expect(finance.execute({
      action_id: "cai.finance.01.plan_list",
      input: { club_id: clubId },
      context: { ...context, capability_version: "veraltet" },
      capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(calls.length).toBe(0);
  });

  test("gibt bei einer Ablehnung des Dienstes keine Zahlen preis", async () => {
    let forbidden = 0;
    const finance = createK14ToolSet({
      client: client(async (request) => { throw createConnectorError({ code: "PERMISSION_DENIED", message: "Kontostand 12.345,67 EUR gesperrt", request_id: request.context.request_id, retryable: false }); }),
      on_backend_forbidden() { forbidden++; },
    });
    await expect(finance.execute({ action_id: "cai.finance.02.plan_show", input: { club_id: clubId, year: 2026 }, context: reader(["finance.read"]), capability_snapshot: manager }))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED", message: "Der Finance-Service hat die Buchhaltungs-Aktion im aktuellen Kontext abgelehnt." });
    expect(forbidden).toBe(1);
  });
});

describe("K14: der Scope trennt, wo das Vereinsrecht es nicht tut", () => {
  // `require_club_finance_access` im finance-service kennt kein Leserecht:
  // Lesen und Schreiben verlangen dieselben zwei Rechte. Wer einem Agenten nur
  // `finance.read` erteilt, muss trotzdem sicher sein, dass er nichts ändert —
  // diese Trennung leistet allein der Scope, und genau das prüft dieser Fall.
  // Gemessen, nicht angenommen: Bei einem dynamischen Werkzeugkatalog bleibt
  // eine Aktion ohne passenden Scope SICHTBAR — so kann der Agent sie anfragen
  // und ein Scope-Upgrade auslösen (ToolVisibilityPolicy, `visible:
  // provider_tool_updates === "dynamic"` bei SCOPE_REQUIRED). In den anderen
  // Bereichen fällt das nicht auf, weil dort ein getrenntes Leserecht die
  // Schreibaktionen schon an der Berechtigung aussortiert. Die Buchhaltung hat
  // kein solches Recht — hier trägt allein der Scope, und er greift bei der
  // AUSFÜHRUNG. Genau das prüft der nächste Fall.
  test("ein reiner Lese-Grant sieht die schreibenden Aktionen, darf sie aber nicht", async () => {
    const { calls, client: adapter } = recording(entry);
    const finance = createK14ToolSet({ client: adapter, write_safety: allowWrites });
    const sichtbar = finance.listVisible({ context: reader(["finance.read"]), capability_snapshot: manager }).map((definition) => definition.action_id);
    expect(sichtbar).toContain("cai.finance.01.plan_list");
    expect(sichtbar).toContain("cai.finance.20.entry_approve");

    await expect(finance.execute({ action_id: "cai.finance.20.entry_approve", input: { club_id: clubId, entry_id: entryId }, context: reader(["finance.read"]), capability_snapshot: manager }))
      .rejects.toMatchObject({ code: "SCOPE_REQUIRED", required_scope: "finance.write" });
    expect(calls.length).toBe(0);
  });

  test("auch eine harmlos aussehende Änderung braucht den Schreib-Scope", async () => {
    const { calls, client: adapter } = recording(entry);
    const finance = createK14ToolSet({ client: adapter, write_safety: allowWrites });
    await expect(finance.execute({
      action_id: "cai.finance.18.entry_update",
      input: { club_id: clubId, entry_id: entryId, changes: { notes: "Randnotiz" } },
      context: reader(["finance.read"]), capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "SCOPE_REQUIRED" });
    expect(calls.length).toBe(0);
  });

  test("ein Schreib-Grant sieht die schreibenden Aktionen", () => {
    const finance = createK14ToolSet({ client: client(async () => []), write_safety: allowWrites });
    const sichtbar = finance.listVisible({ context: reader(["finance.read", "finance.write"]), capability_snapshot: manager }).map((definition) => definition.action_id);
    expect(sichtbar).toContain("cai.finance.03.plan_create");
    expect(sichtbar).toContain("cai.finance.20.entry_approve");
  });
});

describe("K14: die vereinsweite Zusammenfassung im Abteilungskontext", () => {
  test("ist gesperrt und nennt den Weg, der passt", async () => {
    const { calls, client: adapter } = recording({ year: 2026, status: "ACTIVE", available_capital_cents: 0, rows: [] });
    const finance = createK14ToolSet({ client: adapter });
    await expect(finance.execute({
      action_id: "cai.finance.14.summary",
      input: { club_id: clubId, operation: "total", year: 2026 },
      context: { ...context, department_id: departmentId, scopes: ["finance.read"] },
      capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH", message: expect.stringContaining("by_department") });
    expect(calls.length).toBe(0);
  });

  test("die Abteilungssicht läuft und trägt die Abteilung im Pfad", async () => {
    const { calls, client: adapter } = recording([]);
    const finance = createK14ToolSet({ client: adapter });
    await finance.execute({
      action_id: "cai.finance.14.summary",
      input: { club_id: clubId, operation: "by_department", year: 2026, department_id: departmentId },
      context: { ...context, department_id: departmentId, scopes: ["finance.read"] },
      capability_snapshot: manager,
    });
    expect(calls[0]?.path).toBe(`/clubs/${clubId}/finance-plans/2026/summary/${departmentId}`);
  });
});

describe("K14: was der Dienst im Rumpf verlangt", () => {
  // `plan-reopen` gibt es hier NICHT, und das ist der Punkt: Der Dienst
  // verlangt dafuer eine Plattformrolle (finance_plans.py:183,
  // `is_platform_admin`), kein Vereinsrecht. Die PermissionPolicy des
  // Connectors kennt nur Vereinsrechte — die Aktion waere fuer jeden
  // Finanzverantwortlichen sichtbar, bestaetigungspflichtig und danach immer
  // 403. Dieser Test haelt die Abwesenheit fest, damit sie niemand
  // "vervollstaendigt".
  test("plan_reopen ist bewusst nicht im Connector", () => {
    const finance = createK14ToolSet({ client: client(async () => null), write_safety: allowWrites });
    const ids = finance.listDefinitions().map((definition) => definition.action_id);
    // 19 aus K14, 16 aus dem vollständigen Finance Hub (hub.ts) — keine davon öffnet wieder.
    expect(ids).toHaveLength(35); // +1 budget-organigramm-04 (cai.finance.36)
    expect(ids.some((id) => id.includes("reopen"))).toBe(false);
  });

  test("plan_close und entry_approve senden ihren Rumpf", async () => {
    const closeCalls = recording(plan);
    const finance = createK14ToolSet({ client: closeCalls.client, write_safety: allowWrites, confirmation: { async confirmOrPreview(_request, mutation) { return mutation(); } } });
    await finance.execute({ action_id: "cai.finance.05.plan_close", input: { club_id: clubId, year: 2026 }, context: reader(["finance.write"]), capability_snapshot: manager });
    expect(closeCalls.calls[0]?.body).toEqual({ force: false });

    // `entry_approve` liest die Buchung zuerst (Herkunftsprüfung vor der
    // Wirkung), der Rumpf steht deshalb am ZWEITEN Aufruf.
    const approveCalls = recording(entry);
    const zweiter = createK14ToolSet({ client: approveCalls.client, write_safety: allowWrites, confirmation: { async confirmOrPreview(_request, mutation) { return mutation(); } } });
    await zweiter.execute({ action_id: "cai.finance.20.entry_approve", input: { club_id: clubId, entry_id: entryId, note: "geprüft" }, context: reader(["finance.write"]), capability_snapshot: manager });
    expect(approveCalls.calls.map((call) => call.method)).toEqual(["GET", "POST"]);
    expect(approveCalls.calls[1]?.body).toEqual({ note: "geprüft" });
  });
});

describe("K14: Buchungen tragen genau eine Richtung", () => {
  test("beide Beträge zugleich werden vor dem Netz abgewiesen", async () => {
    const { calls, client: adapter } = recording(entry);
    const finance = createK14ToolSet({ client: adapter, write_safety: allowWrites });
    await expect(finance.execute({
      action_id: "cai.finance.16.entry_create",
      input: { club_id: clubId, position_id: positionId, description: "Doppelt", revenue_cents: 100, expense_cents: 100, booking_date: "2026-03-01" },
      context: reader(["finance.write"]), capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(calls.length).toBe(0);
  });

  test("gar kein Betrag wird ebenso abgewiesen", async () => {
    const { calls, client: adapter } = recording(entry);
    const finance = createK14ToolSet({ client: adapter, write_safety: allowWrites });
    await expect(finance.execute({
      action_id: "cai.finance.16.entry_create",
      input: { club_id: clubId, position_id: positionId, description: "Leer", booking_date: "2026-03-01" },
      context: reader(["finance.write"]), capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(calls.length).toBe(0);
  });

  test("ein erfundenes Datum kommt nicht durch", async () => {
    const { calls, client: adapter } = recording(entry);
    const finance = createK14ToolSet({ client: adapter, write_safety: allowWrites });
    await expect(finance.execute({
      action_id: "cai.finance.16.entry_create",
      input: { club_id: clubId, position_id: positionId, description: "Februar 30", expense_cents: 100, booking_date: "2026-02-30" },
      context: reader(["finance.write"]), capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(calls.length).toBe(0);
  });
});

describe("K14: Löschen prüft erst, wem der Satz gehört", () => {
  test("eine fremde Buchung wird nach dem Preflight nicht gelöscht", async () => {
    const calls: ComvenioApiRequest[] = [];
    const finance = createK14ToolSet({
      client: client(async (request) => { calls.push(request); return { ...entry, club_id: otherClubId }; }),
      write_safety: allowWrites,
      confirmation: { async confirmOrPreview(_request, mutation) { return mutation(); } },
    });
    await expect(finance.execute({ action_id: "cai.finance.19.entry_delete", input: { club_id: clubId, entry_id: entryId }, context: reader(["finance.write"]), capability_snapshot: manager }))
      .rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  test("die eigene Buchung wird gelesen und dann gelöscht", async () => {
    const calls: ComvenioApiRequest[] = [];
    const finance = createK14ToolSet({
      client: client(async (request) => { calls.push(request); return request.method === "GET" ? entry : null; }),
      write_safety: allowWrites,
      confirmation: { async confirmOrPreview(_request, mutation) { return mutation(); } },
    });
    const ergebnis = await finance.execute({ action_id: "cai.finance.19.entry_delete", input: { club_id: clubId, entry_id: entryId }, context: reader(["finance.write"]), capability_snapshot: manager });
    expect(calls.map((call) => call.method)).toEqual(["GET", "DELETE"]);
    expect(ergebnis.result).toEqual({ deleted: true, entry_id: entryId });
  });
});

describe("K14: kritische Wirkungen gehen nicht ohne Bestätigung", () => {
  const kritisch = ["cai.finance.05.plan_close", "cai.finance.07.plan_copy", "cai.finance.12.position_delete", "cai.finance.19.entry_delete", "cai.finance.20.entry_approve"] as const;

  test("alle fünf verlangen eine Vorschau", () => {
    const finance = createK14ToolSet({ client: client(async () => null), write_safety: allowWrites });
    const definitionen = finance.listDefinitions();
    for (const id of kritisch) {
      const definition = definitionen.find((eintrag) => eintrag.action_id === id);
      expect(definition, id).toBeDefined();
      for (const operation of Object.values(definition!.operations)) {
        expect(operation.execution_gate, `${id}:${operation.operation}`).toBe("confirmation");
      }
    }
  });

  test("der erste Aufruf liefert die Vorschau statt der Wirkung", async () => {
    const { calls, client: adapter } = recording(plan);
    const finance = createK14ToolSet({ client: adapter, write_safety: allowWrites });
    const ergebnis = await finance.execute({ action_id: "cai.finance.05.plan_close", input: { club_id: clubId, year: 2026 }, context: reader(["finance.write"]), capability_snapshot: manager });
    expect(ergebnis.status).toBe("confirmation_required");
    expect(calls.length).toBe(0);
    const vorschau = (ergebnis.result as { preview: { effects: { type: string }[] } }).preview;
    expect(vorschau.effects.map((wirkung) => wirkung.type)).toContain("plan_lock");
  });
});

describe("K14: Datensparsamkeit", () => {
  test("Personenkennungen verlassen den Connector nicht", async () => {
    const finance = createK14ToolSet({ client: client(async () => entry) });
    const ergebnis = await finance.execute({ action_id: "cai.finance.17.entry_show", input: { club_id: clubId, entry_id: entryId }, context: reader(["finance.read"]), capability_snapshot: manager });
    const roh = JSON.stringify(ergebnis.result);
    expect(roh).not.toContain(actorId);
    expect(ergebnis.result).toMatchObject({ entry_id: entryId, expense_cents: 12_000, approved_at: "2026-03-02T08:00:00Z" });
    expect(Object.keys(ergebnis.result as object)).not.toContain("approved_by");
    expect(Object.keys(ergebnis.result as object)).not.toContain("created_by");
    expect(Object.keys(ergebnis.result as object)).not.toContain("club_id");
  });

  test("eine Liste wird begrenzt und meldet die Kürzung", async () => {
    const viele = Array.from({ length: 5 }, (_, index) => ({ ...plan, id: `6666666${index}-6666-4666-8666-666666666666`, year: 2020 + index }));
    const finance = createK14ToolSet({ client: client(async () => viele) });
    const ergebnis = await finance.execute({ action_id: "cai.finance.01.plan_list", input: { club_id: clubId, limit: 2 }, context: reader(["finance.read"]), capability_snapshot: manager });
    expect(ergebnis.result).toMatchObject({ returned: 2, truncated: true });
    expect((ergebnis.result as { items: unknown[] }).items.length).toBe(2);
  });
});

describe("K14: die Postenliste filtert nach der Abteilung des Kontexts", () => {
  test("ohne eigene Angabe übernimmt sie die Abteilung des Kontexts", async () => {
    const { calls, client: adapter } = recording([]);
    const finance = createK14ToolSet({ client: adapter });
    await finance.execute({
      action_id: "cai.finance.08.position_list",
      input: { club_id: clubId, year: 2026 },
      context: { ...context, department_id: departmentId, scopes: ["finance.read"] },
      capability_snapshot: manager,
    });
    expect(calls[0]?.query).toEqual({ department_id: departmentId });
  });

  test("ohne Abteilungskontext bleibt der Filter leer", async () => {
    const { calls, client: adapter } = recording([]);
    const finance = createK14ToolSet({ client: adapter });
    await finance.execute({ action_id: "cai.finance.08.position_list", input: { club_id: clubId, year: 2026 }, context: reader(["finance.read"]), capability_snapshot: manager });
    expect(calls[0]?.query).toEqual({});
  });
});

// ── Fremdvalidierung Runde 1 (2026-09-21) ───────────────────────────────────

describe("K14: eine Mutation prueft die Herkunft, BEVOR sie wirkt", () => {
  // Der schwerste Befund der Pruefung: Bei einer nackten Ressourcenkennung
  // ermittelt der Dienst den Verein aus der Ressource und prueft die Rechte
  // fuer GENAU DIESEN Verein. Wer in zwei Vereinen Rechte hat, konnte im
  // Kontext von A eine Kennung aus B aendern — `assertTenant` auf der Antwort
  // verwarf danach nur noch das Ergebnis. Geschrieben war es trotzdem.
  const fremd = { ...entry, club_id: otherClubId };
  const fremdePosition = { id: positionId, club_id: otherClubId, department_id: null, name: "Fremder Posten" };

  test("entry_approve schreibt nicht in einen fremden Verein", async () => {
    const calls: ComvenioApiRequest[] = [];
    const finance = createK14ToolSet({
      client: client(async (request) => { calls.push(request); return fremd; }),
      write_safety: allowWrites,
      confirmation: { async confirmOrPreview(_request, mutation) { return mutation(); } },
    });
    await expect(finance.execute({ action_id: "cai.finance.20.entry_approve", input: { club_id: clubId, entry_id: entryId }, context: reader(["finance.write"]), capability_snapshot: manager }))
      .rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  test("entry_create legt nichts an einer fremden Position an", async () => {
    const calls: ComvenioApiRequest[] = [];
    const finance = createK14ToolSet({ client: client(async (request) => { calls.push(request); return fremdePosition; }), write_safety: allowWrites });
    await expect(finance.execute({
      action_id: "cai.finance.16.entry_create",
      input: { club_id: clubId, position_id: positionId, description: "Fremd", expense_cents: 100, booking_date: "2026-03-01" },
      context: reader(["finance.write"]), capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  test("position_update, entry_update und import-shopping ebenso", async () => {
    for (const fall of [
      { id: "cai.finance.11.position_update" as const, input: { club_id: clubId, position_id: positionId, changes: { name: "Neu" } }, antwort: fremdePosition },
      { id: "cai.finance.18.entry_update" as const, input: { club_id: clubId, entry_id: entryId, changes: { notes: "Neu" } }, antwort: fremd },
      { id: "cai.finance.13.position_import_shopping" as const, input: { club_id: clubId, position_id: positionId }, antwort: fremdePosition },
    ]) {
      const calls: ComvenioApiRequest[] = [];
      const finance = createK14ToolSet({ client: client(async (request) => { calls.push(request); return fall.antwort; }), write_safety: allowWrites });
      await expect(finance.execute({ action_id: fall.id, input: fall.input, context: reader(["finance.write"]), capability_snapshot: manager }), fall.id)
        .rejects.toMatchObject({ code: "TENANT_MISMATCH" });
      expect(calls.map((call) => call.method), fall.id).toEqual(["GET"]);
    }
  });

  test("der eigene Verein geht durch — erst lesen, dann schreiben", async () => {
    const calls: ComvenioApiRequest[] = [];
    const finance = createK14ToolSet({
      client: client(async (request) => { calls.push(request); return entry; }),
      write_safety: allowWrites,
      confirmation: { async confirmOrPreview(_request, mutation) { return mutation(); } },
    });
    const ergebnis = await finance.execute({ action_id: "cai.finance.20.entry_approve", input: { club_id: clubId, entry_id: entryId }, context: reader(["finance.write"]), capability_snapshot: manager });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /entries/${entryId}`, `POST /entries/${entryId}/approve`]);
    expect(ergebnis.result).toMatchObject({ entry_id: entryId });
  });
});

describe("K14: der Jahresplan gehoert dem Verein, nicht einer Abteilung", () => {
  const imBereich = { ...context, department_id: departmentId, scopes: ["finance.read", "finance.write"] as RequestContext["scopes"] };

  test("keine Planaktion laeuft im Abteilungskontext", async () => {
    for (const [id, input] of [
      ["cai.finance.01.plan_list", { club_id: clubId }],
      ["cai.finance.02.plan_show", { club_id: clubId, year: 2026 }],
      ["cai.finance.03.plan_create", { club_id: clubId, year: 2026 }],
      ["cai.finance.04.plan_update", { club_id: clubId, year: 2026, changes: { notes: "x" } }],
      ["cai.finance.05.plan_close", { club_id: clubId, year: 2026 }],
      ["cai.finance.07.plan_copy", { club_id: clubId, year: 2026, source_year: 2025 }],
    ] as const) {
      const { calls, client: adapter } = recording(plan);
      const finance = createK14ToolSet({ client: adapter, write_safety: allowWrites });
      await expect(finance.execute({ action_id: id, input, context: imBereich, capability_snapshot: manager }), id)
        .rejects.toMatchObject({ code: "TENANT_MISMATCH" });
      expect(calls.length, id).toBe(0);
    }
  });

  test("ein Posten im Abteilungskontext braucht seine Abteilung", async () => {
    const { calls, client: adapter } = recording(null);
    const finance = createK14ToolSet({ client: adapter, write_safety: allowWrites });
    await expect(finance.execute({
      action_id: "cai.finance.09.position_create",
      input: { club_id: clubId, year: 2026, name: "Ohne Abteilung" },
      context: imBereich, capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(calls.length).toBe(0);
  });

  // Eine Buchung traegt kein `department_id`; ihre Abteilung steht an der
  // Position. Ohne das Nachladen blieb die Abteilungsgrenze bei Buchungen
  // wirkungslos.
  test("eine Buchung aus einer fremden Abteilung wird verworfen", async () => {
    const calls: ComvenioApiRequest[] = [];
    const finance = createK14ToolSet({
      client: client(async (request) => {
        calls.push(request);
        return request.path.startsWith("/entries/")
          ? entry
          : { id: positionId, club_id: clubId, department_id: otherDepartmentId, name: "Fremde Abteilung" };
      }),
    });
    await expect(finance.execute({ action_id: "cai.finance.17.entry_show", input: { club_id: clubId, entry_id: entryId }, context: { ...imBereich, scopes: ["finance.read"] }, capability_snapshot: manager }))
      .rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls.map((call) => call.path)).toEqual([`/entries/${entryId}`, `/positions/${positionId}`]);
  });

  test("ohne Abteilungskontext wird die Position nicht nachgeladen", async () => {
    const calls: ComvenioApiRequest[] = [];
    const finance = createK14ToolSet({ client: client(async (request) => { calls.push(request); return entry; }) });
    await finance.execute({ action_id: "cai.finance.17.entry_show", input: { club_id: clubId, entry_id: entryId }, context: reader(["finance.read"]), capability_snapshot: manager });
    expect(calls.map((call) => call.path)).toEqual([`/entries/${entryId}`]);
  });
});

describe("K14: die Postenfelder decken den Dienstvertrag", () => {
  test("Vorjahreswerte gehen beim Anlegen mit", async () => {
    const { calls, client: adapter } = recording({ id: positionId, club_id: clubId, department_id: departmentId, name: "Sommerfest" });
    const finance = createK14ToolSet({ client: adapter, write_safety: allowWrites });
    await finance.execute({
      action_id: "cai.finance.09.position_create",
      input: { club_id: clubId, year: 2026, name: "Sommerfest", revenue_previous_year_cents: 1_000, expense_previous_year_cents: 2_000 },
      context: reader(["finance.write"]), capability_snapshot: manager,
    });
    expect(calls[0]?.body).toMatchObject({ revenue_previous_year_cents: 1_000, expense_previous_year_cents: 2_000 });
  });

  // Die erste Fassung dieses Falls rief nur `position_create` ohne
  // `department_id` und haette auch dann bestanden, wenn das Feld aus
  // `positionChanges` ganz verschwunden waere. Er behauptete etwas, das er
  // nicht mass. Fremdvalidierung Runde 2 (2026-09-21).
  test("department_id ist beim Aendern wirklich uebertragbar", async () => {
    const calls: ComvenioApiRequest[] = [];
    const finance = createK14ToolSet({
      client: client(async (request) => { calls.push(request); return { id: positionId, club_id: clubId, department_id: departmentId, name: "Sommerfest" }; }),
      write_safety: allowWrites,
    });
    await finance.execute({
      action_id: "cai.finance.11.position_update",
      input: { club_id: clubId, position_id: positionId, changes: { department_id: otherDepartmentId, revenue_previous_year_cents: 500 } },
      context: reader(["finance.write"]), capability_snapshot: manager,
    });
    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.body).toEqual({ department_id: otherDepartmentId, revenue_previous_year_cents: 500 });
  });
});

// ── Fremdvalidierung Runde 2 (2026-09-21) ───────────────────────────────────

describe("K14: die Vorpruefung verlangt einen Beleg, sie vermutet nicht", () => {
  // `club_id` ist im finance-service `nullable=True` (base_model.py:14). Eine
  // Antwort ohne Verein passierte die alte Pruefung, ohne je verglichen
  // worden zu sein — fail-open genau an der Stelle, die schuetzen soll.
  test("eine Antwort ohne club_id wird abgelehnt, nicht durchgelassen", async () => {
    const calls: ComvenioApiRequest[] = [];
    const finance = createK14ToolSet({
      client: client(async (request) => { calls.push(request); return { id: entryId, budget_position_id: positionId, description: "Ohne Verein" }; }),
      write_safety: allowWrites,
      confirmation: { async confirmOrPreview(_request, mutation) { return mutation(); } },
    });
    await expect(finance.execute({ action_id: "cai.finance.20.entry_approve", input: { club_id: clubId, entry_id: entryId }, context: reader(["finance.write"]), capability_snapshot: manager }))
      .rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  test("auch eine leere oder unlesbare Antwort haelt die Mutation auf", async () => {
    // Kein `as const`: Das machte die Liste `readonly`, und `readonly []`
    // passt nicht auf `JsonValue`. bun test merkt davon nichts — `tsc -b`
    // schon.
    for (const antwort of [null, [], "nichts"] as JsonValue[]) {
      const calls: ComvenioApiRequest[] = [];
      const finance = createK14ToolSet({ client: client(async (request) => { calls.push(request); return antwort; }), write_safety: allowWrites });
      await expect(finance.execute({ action_id: "cai.finance.18.entry_update", input: { club_id: clubId, entry_id: entryId, changes: { notes: "x" } }, context: reader(["finance.write"]), capability_snapshot: manager }), String(antwort))
        .rejects.toMatchObject({ code: "TENANT_MISMATCH" });
      expect(calls.map((call) => call.method), String(antwort)).toEqual(["GET"]);
    }
  });

  // `department_id: null` heisst vereinsweit — das liegt AUSSERHALB eines
  // Abteilungskontexts und wurde vorher als unauffaellig durchgewunken.
  test("ein vereinsweiter Posten ist im Abteilungskontext nicht aenderbar", async () => {
    const calls: ComvenioApiRequest[] = [];
    const finance = createK14ToolSet({
      client: client(async (request) => { calls.push(request); return { id: positionId, club_id: clubId, department_id: null, name: "Vereinsweit" }; }),
      write_safety: allowWrites,
    });
    await expect(finance.execute({
      action_id: "cai.finance.11.position_update",
      input: { club_id: clubId, position_id: positionId, changes: { name: "Neu" } },
      context: { ...context, department_id: departmentId, scopes: ["finance.write"] }, capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  test("einen Posten vereinsweit zu machen, verlangt den vereinsweiten Kontext", async () => {
    const { calls, client: adapter } = recording({ id: positionId, club_id: clubId, department_id: departmentId });
    const finance = createK14ToolSet({ client: adapter, write_safety: allowWrites });
    await expect(finance.execute({
      action_id: "cai.finance.11.position_update",
      input: { club_id: clubId, position_id: positionId, changes: { department_id: null } },
      context: { ...context, department_id: departmentId, scopes: ["finance.write"] }, capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls.length).toBe(0);
  });
});

describe("K14: ein Elternposten ist eine Wirkung auf fremdem Gebiet", () => {
  // Die Werte des Kindes werden in den Elternposten eingerollt und in der
  // Zusammenfassung SEINER Abteilung gezaehlt. Der Dienst prueft dabei nur
  // den Jahresplan, nicht die Abteilung (budget_positions.py:99/184).
  test("ein fremder Elternposten haelt das Anlegen auf", async () => {
    const calls: ComvenioApiRequest[] = [];
    const finance = createK14ToolSet({
      client: client(async (request) => { calls.push(request); return { id: "99999999-9999-4999-8999-999999999999", club_id: otherClubId, department_id: null, name: "Fremdes Festival" }; }),
      write_safety: allowWrites,
    });
    await expect(finance.execute({
      action_id: "cai.finance.09.position_create",
      input: { club_id: clubId, year: 2026, name: "Kind", parent_position_id: "99999999-9999-4999-8999-999999999999" },
      context: reader(["finance.write"]), capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  test("ohne Elternposten wird nichts nachgeladen", async () => {
    const { calls, client: adapter } = recording({ id: positionId, club_id: clubId, department_id: null, name: "Eigenstaendig" });
    const finance = createK14ToolSet({ client: adapter, write_safety: allowWrites });
    await finance.execute({
      action_id: "cai.finance.09.position_create",
      input: { club_id: clubId, year: 2026, name: "Eigenstaendig" },
      context: reader(["finance.write"]), capability_snapshot: manager,
    });
    expect(calls.map((call) => call.method)).toEqual(["POST"]);
  });
});

describe("K14: der Routenvertrag nennt die Vorpruefungen", () => {
  // Die Definitionen verschwiegen fuenf GET-Aufrufe, die zur Laufzeit
  // stattfinden. Wer den veroeffentlichten Vertrag liest, muss sehen, was der
  // Connector wirklich ruft.
  test("jede Aktion mit Vorpruefung fuehrt sie als preflight", () => {
    const finance = createK14ToolSet({ client: client(async () => null), write_safety: allowWrites });
    const mitPreflight = ["cai.finance.09.position_create", "cai.finance.11.position_update", "cai.finance.12.position_delete", "cai.finance.13.position_import_shopping", "cai.finance.16.entry_create", "cai.finance.18.entry_update", "cai.finance.19.entry_delete", "cai.finance.20.entry_approve",
      // hub.ts: Vorprüfung, wo der Pfad nur eine nackte Kennung trägt.
      "cai.finance.24.money_account", "cai.finance.25.entry_correction", "cai.finance.26.cash_report", "cai.finance.32.investment_plan", "cai.finance.33.investment_item", "cai.finance.34.investment_funding", "cai.finance.35.investment_scenario",
      // budget-organigramm-04: Rubrik ändern/löschen und Aufteilen tragen nur eine nackte Kennung.
      "cai.finance.36.budget_organigram"];
    for (const definition of finance.listDefinitions()) {
      const routen = Object.values(definition.operations).flatMap((operation) => operation.backend_routes);
      const hatPreflight = routen.some((route) => route.purpose === "preflight");
      expect(hatPreflight, definition.action_id).toBe(mitPreflight.includes(definition.action_id));
    }
  });
});

