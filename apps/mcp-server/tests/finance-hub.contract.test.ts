import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";
import type { ComvenioApiBinary, ComvenioApiClient, ComvenioApiRequest } from "@comvenio/comvenio-client";
import type { CapabilitySnapshot } from "../../../packages/auth/src/index.ts";

import { createK14ToolSet, HUB_ACTION_DEFINITIONS, hubOperationCount } from "../src/tools/finance/index.ts";

// Finance Hub vollständig (hub.ts): die Sicherheitsbausteine von K14 gelten
// für jede neue Teiloperation — Mandant, Vorprüfung, Bestätigung, Datenschutz.

const clubId = "0ec34e70-999a-47c4-a1b1-bdb293110fa5";
const otherClubId = "11111111-1111-4111-8111-111111111111";
const actorId = "44444444-4444-4444-8444-444444444444";
const planId = "55555555-5555-4555-8555-555555555555";
const entryId = "33333333-3333-4333-8333-333333333333";
const reportId = "66666666-6666-4666-8666-666666666666";
const accountId = "99999999-9999-4999-8999-999999999999";

const context: RequestContext = {
  request_id: "77777777-7777-4777-8777-777777777777",
  surface: "mcp",
  provider: "anthropic",
  subject_id: actorId,
  oauth_grant_id: "88888888-8888-4888-8888-888888888888",
  club_id: clubId,
  department_id: null,
  scopes: ["finance.read", "finance.write"],
  capability_version: "test-1",
  locale: "de-DE",
  timezone: "Europe/Berlin",
};
const manager: CapabilitySnapshot = {
  member_id: actorId,
  subject_id: actorId,
  club_id: clubId,
  department_ids: [],
  permissions: { manage_finances: true },
  sources: [],
  capability_version: "test-1",
  generated_at: "2026-09-23T00:00:00Z",
  observed_at: "2026-09-23T00:00:00Z",
  expires_at: "2099-01-01T00:00:00Z",
};
const allowWrites = { async execute(_request: unknown, mutation: () => Promise<JsonValue>) { return mutation(); } };
const confirmAll = { async confirmOrPreview(_request: unknown, mutation: () => Promise<JsonValue>) { return mutation(); } };

function recording(answer: (request: ComvenioApiRequest) => JsonValue, bytes?: ComvenioApiBinary) {
  const calls: ComvenioApiRequest[] = [];
  const client: ComvenioApiClient = {
    timeout_ms: 15_000,
    async request<T extends JsonValue>(request: ComvenioApiRequest): Promise<T> { calls.push(request); return answer(request) as T; },
    ...(bytes ? { async requestBytes(request: ComvenioApiRequest) { calls.push(request); return bytes; } } : {}),
  };
  return { calls, client };
}

describe("Finance Hub: Inventar", () => {
  test("18 Aktionen mit ihren Teiloperationen, keine davon öffnet einen Plan wieder", () => {
    // +1 budget-saison-03 (cai.finance.37.budget_season), +1 buchhaltung-13-04 (cai.finance.38.entry_detail).
    expect(Object.keys(HUB_ACTION_DEFINITIONS)).toHaveLength(18);
    expect(hubOperationCount()).toBeGreaterThan(70);
    const routes = Object.values(HUB_ACTION_DEFINITIONS).flatMap((definition) => Object.values(definition.operations).flatMap((operation) => operation.backend_routes));
    expect(routes.some((route) => route.normalized_path_template.includes("reopen"))).toBe(false);
  });

  test("kritische Schreibvorgänge verlangen eine Bestätigung", () => {
    const gate = (id: string, op: string) => HUB_ACTION_DEFINITIONS[id]!.operations[op]!.execution_gate;
    expect(gate("cai.finance.22.plan_lifecycle", "close")).toBe("confirmation");
    expect(gate("cai.finance.22.plan_lifecycle", "next_period")).toBe("confirmation");
    expect(gate("cai.finance.25.entry_correction", "reverse")).toBe("confirmation");
    expect(gate("cai.finance.26.cash_report", "approve")).toBe("confirmation");
    // Correction loop: the bulk approval fixes entries — confirmed like the report's approval.
    expect(gate("cai.finance.26.cash_report", "approve_entries")).toBe("confirmation");
    expect(gate("cai.finance.25.entry_correction", "objection_create")).toBe("write_safety");
    expect(gate("cai.finance.30.audit_export", "create")).toBe("confirmation");
    expect(gate("cai.finance.24.money_account", "reconciliation")).toBe("inline");
  });
});

describe("Finance Hub: Mandant und Vorprüfung", () => {
  test("ein Storno an einer Buchung eines anderen Vereins wird vor dem Schreiben abgewiesen", async () => {
    const { calls, client } = recording(() => ({ id: entryId, club_id: otherClubId }));
    const finance = createK14ToolSet({ client, write_safety: allowWrites, confirmation: confirmAll });
    await expect(finance.execute({
      action_id: "cai.finance.25.entry_correction",
      input: { club_id: clubId, operation: "reverse", entry_id: entryId, data: { reason: "Doppelt gebucht" } },
      context,
      capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  test("Korrekturschleife: eine Beanstandung wird nur über die Liste ihrer vereinseigenen Buchung zurückgezogen", async () => {
    const objectionId = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
    const input = { club_id: clubId, operation: "objection_withdraw", entry_id: entryId, objection_id: objectionId, data: { note: "Beleg gefunden" } };
    const own = recording((request): JsonValue => request.method === "GET"
      ? [{ id: objectionId, club_id: clubId, booking_entry_id: entryId }]
      : { id: objectionId, club_id: clubId, resolution: "WITHDRAWN" });
    await createK14ToolSet({ client: own.client, write_safety: allowWrites })
      .execute({ action_id: "cai.finance.25.entry_correction", input, context, capability_snapshot: manager });
    expect(own.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET /entries/${entryId}/objections`,
      `POST /objections/${objectionId}/withdraw`,
    ]);
    expect(own.calls[1]?.body).toEqual({ note: "Beleg gefunden" });

    // Not in the list of this entry, or listed under another club: refused before the write.
    for (const rows of [[], [{ id: objectionId, club_id: otherClubId }]]) {
      const foreign = recording(() => rows as JsonValue);
      await expect(createK14ToolSet({ client: foreign.client, write_safety: allowWrites })
        .execute({ action_id: "cai.finance.25.entry_correction", input, context, capability_snapshot: manager }))
        .rejects.toMatchObject({ code: "TENANT_MISMATCH" });
      expect(foreign.calls).toHaveLength(1);
    }
  });

  test("ein Geldkonto, das nicht in der Liste des Vereins steht, wird nicht geändert", async () => {
    const { calls, client } = recording(() => [{ id: "12121212-1212-4212-8212-121212121212", club_id: clubId }]);
    const finance = createK14ToolSet({ client, write_safety: allowWrites });
    await expect(finance.execute({
      action_id: "cai.finance.24.money_account",
      input: { club_id: clubId, operation: "update", account_id: accountId, data: { name: "Kasse" } },
      context,
      capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toEqual({ include_archived: "true" });
  });

  test("die Freigabe eines Kassenberichts prüft den Bericht und schickt dann den Rumpf", async () => {
    const { calls, client } = recording((request): JsonValue => request.method === "GET"
      ? { id: reportId, club_id: clubId }
      : { id: reportId, club_id: clubId, report_status: "APPROVED", approved_by: actorId });
    const finance = createK14ToolSet({ client, write_safety: allowWrites, confirmation: confirmAll });
    const result = await finance.execute({
      action_id: "cai.finance.26.cash_report",
      input: { club_id: clubId, operation: "approve", report_id: reportId, data: { force: true } },
      context,
      capability_snapshot: manager,
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /reports/cash/${reportId}`, `POST /reports/cash/${reportId}/approve`]);
    expect(calls[1]?.body).toEqual({ force: true });
    // Personenkennungen fallen heraus (redactFinanceValue).
    expect(result.result).toEqual({ id: reportId, club_id: clubId, report_status: "APPROVED" });
  });

  test("Investitionsplan: die Herkunft steht in der Dashboard-Antwort unter plan", async () => {
    // GET /investment-plans/{id} answers {plan, items, …} — first seen in PROD on 2026-09-23.
    const dashboard = (club: string): JsonValue => ({ plan: { id: planId, club_id: club }, items: [], total_estimated_cost_cents: 0 });
    const own = recording((request): JsonValue => request.method === "GET" ? dashboard(clubId) : { id: entryId, investment_plan_id: planId });
    const finance = createK14ToolSet({ client: own.client, write_safety: allowWrites });
    const input = { club_id: clubId, operation: "create", investment_plan_id: planId, data: { title: "Rohbau", estimated_cost_cents: 100 } };
    await finance.execute({ action_id: "cai.finance.33.investment_item", input, context, capability_snapshot: manager });
    expect(own.calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /investment-plans/${planId}`, `POST /investment-plans/${planId}/items`]);

    const foreign = recording(() => dashboard(otherClubId));
    await expect(createK14ToolSet({ client: foreign.client, write_safety: allowWrites }).execute({ action_id: "cai.finance.33.investment_item", input, context, capability_snapshot: manager }))
      .rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(foreign.calls).toHaveLength(1);
  });

  test("Szenario: der Plan steht in der Detail-Antwort unter scenario", async () => {
    // GET /scenarios/{id} answers {scenario, entries, liquidity} — seen in PROD on 2026-09-23.
    const scenarioId = "abababab-abab-4bab-8bab-abababababab";
    const { calls, client } = recording((request): JsonValue => {
      if (request.path === `/scenarios/${scenarioId}`) return { scenario: { id: scenarioId, investment_plan_id: planId }, entries: [], liquidity: {} };
      if (request.path === `/investment-plans/${planId}`) return { plan: { id: planId, club_id: clubId }, items: [] };
      return [];
    });
    const finance = createK14ToolSet({ client, write_safety: allowWrites });
    await finance.execute({ action_id: "cai.finance.35.investment_scenario", input: { club_id: clubId, operation: "auto_generate", scenario_id: scenarioId }, context, capability_snapshot: manager });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /scenarios/${scenarioId}`, `GET /investment-plans/${planId}`, `POST /scenarios/${scenarioId}/auto-generate`]);
  });

  test("eine Antwort mit fremdem Verein wird verworfen", async () => {
    const { client } = recording(() => ({ id: planId, club_id: otherClubId }));
    const finance = createK14ToolSet({ client });
    await expect(finance.execute({
      action_id: "cai.finance.21.plan_period",
      input: { club_id: clubId, operation: "show", plan_id: planId },
      context,
      capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
  });

  test("eine Eingabe für einen anderen Verein erreicht den Dienst nicht", async () => {
    const { calls, client } = recording(() => ({}));
    const finance = createK14ToolSet({ client, write_safety: allowWrites });
    await expect(finance.execute({
      action_id: "cai.finance.24.money_account",
      input: { club_id: otherClubId, operation: "create", data: { name: "Kasse", kind: "CASH" } },
      context,
      capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(calls).toHaveLength(0);
  });
});

describe("Finance Hub: Prüfexport als Datei", () => {
  test("liefert Bytes als base64 mit Prüfsumme", async () => {
    const bytes = new TextEncoder().encode("PK-zip-inhalt");
    const { calls, client } = recording(() => null, { content_type: "application/zip", bytes });
    const finance = createK14ToolSet({ client });
    const result = await finance.execute({
      action_id: "cai.finance.30.audit_export",
      input: { club_id: clubId, operation: "download", plan_id: planId, export_id: reportId },
      context,
      capability_snapshot: manager,
    });
    expect(calls[0]?.path).toBe(`/clubs/${clubId}/finance-plans/by-id/${planId}/audit-exports/${reportId}/download`);
    expect(result.result).toEqual({
      content_type: "application/zip",
      size_bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      content_base64: Buffer.from(bytes).toString("base64"),
    });
  });
});

// budget-organigramm-04 (cai.finance.36): Baum, Rahmen, Abrechnung, Rubriken, Aufteilen.
describe("Finance Hub: Budget im Organigramm", () => {
  const jugendId = "abababab-abab-4bab-8bab-abababababab";
  const rubricId = "cdcdcdcd-1111-4ddd-8ddd-cdcdcdcdcdcd";
  const positionId = "efefefef-efef-4fef-8fef-efefefefefef";
  const action = "cai.finance.36.budget_organigram";

  test("TC-01: neun Teiloperationen, der Rahmen und das Löschen einer Rubrik verlangen eine Bestätigung", () => {
    const operations = HUB_ACTION_DEFINITIONS[action]!.operations;
    expect(Object.keys(operations).sort()).toEqual(
      ["frame_set", "frame_versions", "position_split", "rubric_create", "rubric_delete", "rubric_update", "rubrics", "statement", "tree"],
    );
    expect(operations.frame_set!.execution_gate).toBe("confirmation");
    expect(operations.rubric_delete!.execution_gate).toBe("confirmation");
    expect(operations.position_split!.execution_gate).toBe("write_safety");
    expect(operations.tree!.execution_gate).toBe("inline");
  });

  test("TC-02: der Baum ruft genau GET …/budget-tree und nimmt Knoten mehrerer Abteilungen an", async () => {
    const { calls, client } = recording(() => ({ plan_id: planId, nodes: [
      { node_kind: "DEPARTMENT", node_id: jugendId, department_id: jugendId, name: "Jugend" },
      { node_kind: "DEPARTMENT", node_id: accountId, department_id: accountId, name: "Tennis" },
    ], totals: { scope: "CLUB" } }));
    const result = await createK14ToolSet({ client }).execute({
      action_id: action, input: { club_id: clubId, operation: "tree", plan_id: planId }, context, capability_snapshot: manager,
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /clubs/${clubId}/finance-plans/by-id/${planId}/budget-tree`]);
    expect((result.result as { nodes: unknown[] }).nodes).toHaveLength(2);
  });

  test("TC-03: der Rahmen geht mit Rumpf an PUT …/frames/{kind}/{id}, der Verein als club", async () => {
    const { calls, client } = recording(() => ({ node_kind: "CLUB", node_id: null, amount_cents: 5750000 }));
    await createK14ToolSet({ client, write_safety: allowWrites, confirmation: confirmAll }).execute({
      action_id: action,
      input: { club_id: clubId, operation: "frame_set", plan_id: planId, node_kind: "CLUB", node_id: "club", data: { amount_cents: 5750000 } },
      context, capability_snapshot: manager,
    });
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.path).toBe(`/clubs/${clubId}/finance-plans/by-id/${planId}/frames/CLUB/club`);
    expect(put?.body).toEqual({ amount_cents: 5750000 });
  });

  test("DC-8: die Vorschau des Rahmens nennt alten und neuen Betrag und den Grund", async () => {
    const { client } = recording((call): JsonValue => call.method === "GET"
      ? { plan_id: planId, nodes: [{ node_kind: "DEPARTMENT", node_id: jugendId, frame_cents: 800000 }], totals: { scope: "CLUB" } }
      : {});
    const result = await createK14ToolSet({ client, write_safety: allowWrites }).execute({
      action_id: action,
      input: { club_id: clubId, operation: "frame_set", plan_id: planId, node_kind: "DEPARTMENT", node_id: jugendId, data: { amount_cents: 900000, reason: "Zuschuss Gemeinde" } },
      context, capability_snapshot: manager,
    });
    expect(result.status).toBe("confirmation_required");
    const effects = (result.result as { preview: { effects: Record<string, unknown>[] } }).preview.effects;
    expect(effects.find((effect) => effect.type === "frame_change")).toMatchObject({
      old_amount_cents: 800000, old_amount_read: true, new_amount_cents: 900000, reason: "Zuschuss Gemeinde",
    });
  });

  test("DC-2: die Vorschau des Löschens nennt jeden Unterposten, der mitgeht", async () => {
    const childId = "abcdabcd-0000-4000-8000-000000000001";
    const { calls, client } = recording((call): JsonValue => call.path === `/positions/${positionId}`
      ? { id: positionId, club_id: clubId, finance_plan_id: planId, name: "Neue Trikots", child_count: 1 }
      : [
          { id: positionId, club_id: clubId, parent_position_id: null, name: "Neue Trikots", expense_planned_cents: 30000 },
          { id: childId, club_id: clubId, parent_position_id: positionId, name: "E1", expense_planned_cents: 15000 },
        ]);
    const result = await createK14ToolSet({ client, write_safety: allowWrites }).execute({
      action_id: "cai.finance.12.position_delete", input: { club_id: clubId, position_id: positionId }, context, capability_snapshot: manager,
    });
    expect(result.status).toBe("confirmation_required");
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    const effects = (result.result as { preview: { effects: Record<string, unknown>[] } }).preview.effects;
    const removals = effects.filter((effect) => effect.type === "position_removal");
    expect(removals.map((effect) => effect.position_id)).toEqual([positionId, childId]);
    expect(removals[0]).toMatchObject({ sub_positions_read: true });
  });

  test("R2-02: sieht die Leitung nicht alle Unterposten, sagt die Vorschau das", async () => {
    const { client } = recording((call): JsonValue => call.path === `/positions/${positionId}`
      ? { id: positionId, club_id: clubId, finance_plan_id: planId, name: "Neue Trikots", child_count: 2 }
      : [{ id: "abcdabcd-0000-4000-8000-000000000001", club_id: clubId, parent_position_id: positionId, name: "E1" }]);
    const result = await createK14ToolSet({ client, write_safety: allowWrites }).execute({
      action_id: "cai.finance.12.position_delete", input: { club_id: clubId, position_id: positionId }, context, capability_snapshot: manager,
    });
    const effects = (result.result as { preview: { effects: Record<string, unknown>[] } }).preview.effects;
    expect(effects[1]).toMatchObject({ type: "position_removal", sub_positions_read: false });
  });

  test("TC-04: eine ungültige Knotenart erreicht den Dienst nicht", async () => {
    const { calls, client } = recording(() => ({}));
    await expect(createK14ToolSet({ client, confirmation: confirmAll }).execute({
      action_id: action,
      input: { club_id: clubId, operation: "frame_set", plan_id: planId, node_kind: "SPARTE", node_id: jugendId, data: { amount_cents: 1 } },
      context, capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(calls).toHaveLength(0);
  });

  test("Rubriken: geerbte Zeilen tragen die Abteilung des Vorfahren und werden angenommen", async () => {
    const { calls, client } = recording(() => [
      { id: rubricId, club_id: clubId, name: "Trikots", department_id: accountId, inherited: true },
    ]);
    const result = await createK14ToolSet({ client }).execute({
      action_id: action, input: { club_id: clubId, operation: "rubrics", department_id: jugendId }, context, capability_snapshot: manager,
    });
    expect(calls[0]?.path).toBe(`/clubs/${clubId}/departments/${jugendId}/budget-rubrics`);
    expect(result.result).toHaveLength(1);
  });

  test("Rubrik ändern: nur, wenn sie im Katalog der Abteilung steht", async () => {
    const input = { club_id: clubId, operation: "rubric_update", department_id: jugendId, rubric_id: rubricId, data: { name: "Spielkleidung" } };
    const own = recording((request): JsonValue => request.method === "GET"
      ? [{ id: rubricId, club_id: clubId, name: "Trikots", department_id: jugendId }]
      : { id: rubricId, club_id: clubId, name: "Spielkleidung", department_id: jugendId });
    await createK14ToolSet({ client: own.client, write_safety: allowWrites })
      .execute({ action_id: action, input, context, capability_snapshot: manager });
    expect(own.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET /clubs/${clubId}/departments/${jugendId}/budget-rubrics`,
      `PATCH /budget-rubrics/${rubricId}`,
    ]);
    const foreign = recording(() => [] as JsonValue);
    await expect(createK14ToolSet({ client: foreign.client, write_safety: allowWrites })
      .execute({ action_id: action, input, context, capability_snapshot: manager }))
      .rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(foreign.calls).toHaveLength(1);
  });

  test("Aufteilen prüft den Posten und schickt den Rumpf an PUT /positions/{id}/split", async () => {
    const { calls, client } = recording((request): JsonValue => request.method === "GET"
      ? { id: positionId, club_id: clubId }
      : { position: { id: positionId, club_id: clubId }, children: [], deleted_ids: [] });
    const body = { own_expense_planned_cents: 30000, children: [{ department_id: jugendId, expense_planned_cents: 60000 }] };
    await createK14ToolSet({ client, write_safety: allowWrites }).execute({
      action_id: action, input: { club_id: clubId, operation: "position_split", position_id: positionId, data: body }, context, capability_snapshot: manager,
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /positions/${positionId}`, `PUT /positions/${positionId}/split`]);
    expect(calls[1]?.body).toEqual(body);
  });
});

// budget-saison-03 (cai.finance.37): Saisons, Saisonbaum, Saisonrahmen, Vorschlag.
describe("Finance Hub: Saison und Haushaltsjahr", () => {
  const action = "cai.finance.37.budget_season";
  const jugendId = "abababab-abab-4bab-8bab-abababababab";

  test("TC-01: fünf Teiloperationen, nur der Saisonrahmen verlangt eine Bestätigung", () => {
    const operations = HUB_ACTION_DEFINITIONS[action]!.operations;
    expect(Object.keys(operations).sort()).toEqual(
      ["frame_proposal", "season_frame_set", "season_frame_versions", "season_tree", "seasons"],
    );
    expect(operations.season_frame_set!.execution_gate).toBe("confirmation");
    for (const op of ["seasons", "season_tree", "season_frame_versions", "frame_proposal"]) {
      expect(operations[op]!.execution_gate, op).toBe("inline");
    }
  });

  test("TC-02: der Saisonbaum ruft genau GET …/budget-seasons/{season_start}/tree", async () => {
    const { calls, client } = recording(() => ({ season_start: "2026-07-01", season_end: "2027-04-30", label: "2026/27",
      plans: [], uncovered: [], nodes: [], totals: { scope: "CLUB" } }));
    await createK14ToolSet({ client }).execute({
      action_id: action, input: { club_id: clubId, operation: "season_tree", season_start: "2026-07-01" }, context, capability_snapshot: manager,
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /clubs/${clubId}/budget-seasons/2026-07-01/tree`]);
  });

  test("TC-03: der Saisonrahmen antwortet zuerst mit Vorschau (alt, neu, Grund); eine ungültige Knotenart erreicht den Dienst nicht", async () => {
    const { calls, client } = recording((call): JsonValue => call.method === "GET"
      ? { season_start: "2026-07-01", nodes: [{ node_kind: "DEPARTMENT", node_id: jugendId, frame_cents: 900000 }], totals: { scope: "CLUB" } }
      : {});
    const result = await createK14ToolSet({ client, write_safety: allowWrites }).execute({
      action_id: action,
      input: { club_id: clubId, operation: "season_frame_set", season_start: "2026-07-01", node_kind: "DEPARTMENT", node_id: jugendId, data: { amount_cents: 1000000, reason: "Beschluss Jugendausschuss" } },
      context, capability_snapshot: manager,
    });
    expect(result.status).toBe("confirmation_required");
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
    const effects = (result.result as { preview: { effects: Record<string, unknown>[] } }).preview.effects;
    expect(effects.find((effect) => effect.type === "frame_change")).toMatchObject({
      season_start: "2026-07-01", old_amount_cents: 900000, new_amount_cents: 1000000, reason: "Beschluss Jugendausschuss",
    });
    const refused = recording(() => ({}));
    await expect(createK14ToolSet({ client: refused.client, confirmation: confirmAll }).execute({
      action_id: action,
      input: { club_id: clubId, operation: "season_frame_set", season_start: "2026-07-01", node_kind: "SPARTE", node_id: jugendId, data: { amount_cents: 1 } },
      context, capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(refused.calls).toHaveLength(0);
  });

  test("TC-04: der Vorschlag ruft GET …/by-id/{plan_id}/frames/{kind}/{id}/proposal", async () => {
    const { calls, client } = recording(() => ({ frame_cents: null, proposal_cents: 995000, parts: [] }));
    await createK14ToolSet({ client }).execute({
      action_id: action, input: { club_id: clubId, operation: "frame_proposal", plan_id: planId, node_kind: "DEPARTMENT", node_id: jugendId },
      context, capability_snapshot: manager,
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET /clubs/${clubId}/finance-plans/by-id/${planId}/frames/DEPARTMENT/${jugendId}/proposal`,
    ]);
  });
});

// buchhaltung-13-04 (cai.finance.38 und die Ergänzungen an .18, .21, .27).
describe("Finance Hub: Buchung im Detail", () => {
  const action = "cai.finance.38.entry_detail";
  const transferId = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
  const jugendId = "abababab-abab-4bab-8bab-abababababab";
  const tennisId = "efefefef-efef-4fef-8fef-efefefefefef";

  test("TC-01: entry und open_items, beide lesend; Detail liest erst die Herkunft der Buchung", async () => {
    const operations = HUB_ACTION_DEFINITIONS[action]!.operations;
    expect(Object.keys(operations).sort()).toEqual(["entry", "open_items"]);
    for (const op of ["entry", "open_items"]) expect(operations[op]!.execution_gate, op).toBe("inline");

    const { calls, client } = recording((call): JsonValue => call.path.endsWith("/detail")
      ? { entry: { id: entryId, club_id: clubId }, timeline: [], allowed_actions: { correct: true } }
      : { id: entryId, club_id: clubId });
    await createK14ToolSet({ client }).execute({
      action_id: action, input: { club_id: clubId, operation: "entry", entry_id: entryId }, context, capability_snapshot: manager,
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /entries/${entryId}`, `GET /entries/${entryId}/detail`]);

    const open = recording(() => ({ counts: { OBJECTION_TO_ANSWER: 0 }, items: [] }));
    await createK14ToolSet({ client: open.client }).execute({
      action_id: action, input: { club_id: clubId, operation: "open_items", plan_id: planId }, context, capability_snapshot: manager,
    });
    expect(open.calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /clubs/${clubId}/finance/open-items`]);
    expect(open.calls[0]?.query).toEqual({ plan_id: planId });
  });

  test("TC-02: journal mit nur node_kind scheitert vor dem Aufruf; mit beiden trägt die Abfrage beide Felder", async () => {
    const refused = recording(() => ({}));
    await expect(createK14ToolSet({ client: refused.client }).execute({
      action_id: "cai.finance.21.plan_period", input: { club_id: clubId, operation: "journal", plan_id: planId, node_kind: "DEPARTMENT" },
      context, capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(refused.calls).toHaveLength(0);

    const { calls, client } = recording(() => ({ plan: {}, rows: [], next_after: null, next_before: null, totals: {} }));
    await createK14ToolSet({ client }).execute({
      action_id: "cai.finance.21.plan_period",
      input: { club_id: clubId, operation: "journal", plan_id: planId, node_kind: "DEPARTMENT", node_id: jugendId, order: "desc", before_journal_number: 40 },
      context, capability_snapshot: manager,
    });
    expect(calls[0]?.path).toBe(`/clubs/${clubId}/finance-plans/by-id/${planId}/journal`);
    expect(calls[0]?.query).toEqual({ node_kind: "DEPARTMENT", node_id: jugendId, order: "desc", before_journal_number: "40" });
  });

  test("TC-03: entry_update trägt den Grund im PATCH-Rumpf und verlangt eine Bestätigung", async () => {
    const changes = { expense_cents: 28000, reason: "Rechnung nachgerechnet" };
    const preview = recording(() => ({ id: entryId, club_id: clubId }));
    const asked = await createK14ToolSet({ client: preview.client, write_safety: allowWrites }).execute({
      action_id: "cai.finance.18.entry_update", input: { club_id: clubId, entry_id: entryId, changes }, context, capability_snapshot: manager,
    });
    expect(asked.status).toBe("confirmation_required");
    expect(preview.calls.some((call) => call.method === "PATCH")).toBe(false);
    const effects = (asked.result as { preview: { effects: Record<string, unknown>[] } }).preview.effects;
    expect(effects.find((effect) => effect.type === "booking_correction")).toMatchObject({ fields: ["expense_cents"], reason: "Rechnung nachgerechnet" });

    const { calls, client } = recording(() => ({ id: entryId, club_id: clubId }));
    await createK14ToolSet({ client, write_safety: allowWrites, confirmation: confirmAll }).execute({
      action_id: "cai.finance.18.entry_update", input: { club_id: clubId, entry_id: entryId, changes }, context, capability_snapshot: manager,
    });
    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.path).toBe(`/entries/${entryId}`);
    expect(patch?.body).toMatchObject({ reason: "Rechnung nachgerechnet", expense_cents: 28000 });
  });

  test("R1-13: ein Grund allein ist keine Änderung und erreicht den Dienst nicht", async () => {
    const { calls, client } = recording(() => ({ id: entryId, club_id: clubId }));
    await expect(createK14ToolSet({ client, write_safety: allowWrites, confirmation: confirmAll }).execute({
      action_id: "cai.finance.18.entry_update", input: { club_id: clubId, entry_id: entryId, changes: { reason: "nur ein Grund" } }, context, capability_snapshot: manager,
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(calls).toHaveLength(0);
  });

  test("TC-04: transfer confirm ist kritisch, die Vorschau liest show; die Zahl der Operationen bleibt", async () => {
    const operations = HUB_ACTION_DEFINITIONS["cai.finance.27.department_transfer"]!.operations;
    // list, account_choices, show, create, confirm, reject, withdraw, reverse — wie vor 13-04.
    expect(Object.keys(operations)).toHaveLength(8);
    for (const step of ["confirm", "reject", "withdraw"]) expect(operations[step]!.execution_gate, step).toBe("confirmation");

    const show = { id: transferId, club_id: clubId, amount_cents: 25000, from_department_id: jugendId, to_department_id: tennisId, status: "REQUESTED", reason: "Hallenzeit" };
    const preview = recording(() => show);
    const asked = await createK14ToolSet({ client: preview.client, write_safety: allowWrites }).execute({
      action_id: "cai.finance.27.department_transfer", input: { club_id: clubId, operation: "confirm", transfer_id: transferId }, context, capability_snapshot: manager,
    });
    expect(asked.status).toBe("confirmation_required");
    expect(preview.calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /clubs/${clubId}/department-transfers/${transferId}`]);
    const effects = (asked.result as { preview: { effects: Record<string, unknown>[] } }).preview.effects;
    expect(effects.find((effect) => effect.type === "department_transfer_decision")).toMatchObject({
      step: "confirm", transfer_read: true, amount_cents: 25000, from_department_id: jugendId, to_department_id: tennisId, status: "REQUESTED",
    });

    const { calls, client } = recording(() => show);
    await createK14ToolSet({ client, write_safety: allowWrites, confirmation: confirmAll }).execute({
      action_id: "cai.finance.27.department_transfer", input: { club_id: clubId, operation: "confirm", transfer_id: transferId }, context, capability_snapshot: manager,
    });
    expect(calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual([`/clubs/${clubId}/department-transfers/${transferId}/confirm`]);
  });

  test("TC-05: transfer reject mit decision_note schickt den Rumpf", async () => {
    const { calls, client } = recording(() => ({ id: transferId, club_id: clubId, status: "REJECTED" }));
    await createK14ToolSet({ client, write_safety: allowWrites, confirmation: confirmAll }).execute({
      action_id: "cai.finance.27.department_transfer",
      input: { club_id: clubId, operation: "reject", transfer_id: transferId, data: { decision_note: "Kein Budget mehr" } },
      context, capability_snapshot: manager,
    });
    const post = calls.find((call) => call.method === "POST");
    expect(post?.path).toBe(`/clubs/${clubId}/department-transfers/${transferId}/reject`);
    expect(post?.body).toEqual({ decision_note: "Kein Budget mehr" });
  });
});
