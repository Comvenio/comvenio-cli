import { z } from "zod";

import type { CapabilitySnapshot } from "@comvenio/auth";
import {
  MEMBER_DETAIL_FIELDS_SCHEMA,
  MEMBER_DETAIL_PANEL_SCHEMA,
  MEMBER_MANAGEMENT_WIDGET_SCHEMA,
  MEMBER_SUMMARY_ROW_SCHEMA,
  SERVER_ACTION_DESCRIPTOR_SCHEMA,
  createConnectorError,
  normalizeRequestContext,
  type MemberDetailFields,
  type MemberDetailPanel,
  type MemberManagementWidget,
  type RequestContext,
  type ServerActionDescriptor,
} from "@comvenio/connector-contracts";

import type { MemberManagementProjectorInput, MemberWidgetActionPolicy } from "./types.ts";

const listSource = z.object({
  items: z.array(MEMBER_SUMMARY_ROW_SCHEMA).max(100),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().min(0),
  total: z.number().int().min(0).nullable(),
}).strict();
const detailSource = z.object({ member_id: z.string().uuid() }).extend(MEMBER_DETAIL_FIELDS_SCHEMA.shape).strict();

function bound(input: MemberManagementProjectorInput): { context: RequestContext; snapshot: CapabilitySnapshot } {
  const context = normalizeRequestContext(input.context);
  const snapshot = input.capability_snapshot;
  if (!context.subject_id || !context.oauth_grant_id || !context.club_id) {
    throw createConnectorError({ code: "AUTH_REQUIRED", message: "Für die Mitgliederansicht ist eine aktive Verbindung erforderlich.", request_id: context.request_id, retryable: false });
  }
  if (context.club_id !== input.club.club_id || snapshot.club_id !== input.club.club_id || snapshot.subject_id !== context.subject_id) {
    throw createConnectorError({ code: "TENANT_MISMATCH", message: "Die Mitgliederansicht gehört nicht zum ausgewählten Verein.", request_id: context.request_id, retryable: false });
  }
  if (!context.capability_version || context.capability_version !== snapshot.capability_version) {
    throw createConnectorError({ code: "PERMISSION_DENIED", message: "Die Berechtigungen haben sich geändert. Bitte lade die Mitgliederansicht neu.", request_id: context.request_id, retryable: false });
  }
  if (!context.scopes.includes("member.read.basic") || snapshot.permissions.view_members !== true) {
    throw createConnectorError({ code: "SCOPE_REQUIRED", message: "Für die Mitgliederliste fehlt die aktuelle Leseberechtigung.", request_id: context.request_id, retryable: false, required_scope: "member.read.basic" });
  }
  return { context, snapshot };
}

export function ownMemberPermissionExplanation(snapshot: CapabilitySnapshot): string[] {
  const messages = ["Du darfst die minimierten Mitgliedsbasisdaten dieses Vereins sehen."];
  messages.push(snapshot.permissions.view_members_details === true
    ? "Du darfst einzelne Mitgliederdetails nach einem expliziten Abruf sehen."
    : "Nicht maskierte Mitgliederdetails sind für dich nicht freigegeben.");
  messages.push(snapshot.permissions.manage_members === true
    ? "Du darfst freigegebene Mitgliederaktionen vorbereiten."
    : "Verwaltungs-, Import- und Exportaktionen sind für dich nicht freigegeben.");
  return messages;
}

function selectedDetail(
  input: MemberManagementProjectorInput,
  context: RequestContext,
  snapshot: CapabilitySnapshot,
  rows: z.infer<typeof MEMBER_SUMMARY_ROW_SCHEMA>[],
): MemberDetailPanel | null {
  const request = input.detail_request;
  if (!request) return null;
  if (!context.scopes.includes("member.read.details") || snapshot.permissions.view_members_details !== true) {
    throw createConnectorError({ code: "SCOPE_REQUIRED", message: "Für unmaskierte Mitgliederdetails fehlt die erforderliche Berechtigung.", request_id: context.request_id, retryable: false, required_scope: "member.read.details" });
  }
  const row = rows.find((candidate) => candidate.member_id === request.member_id);
  if (!row) throw createConnectorError({ code: "NOT_FOUND", message: "Das Mitglied ist in der aktuellen Ansicht nicht verfügbar.", request_id: context.request_id, retryable: false });
  const parsed = detailSource.parse(request.source);
  if (parsed.member_id !== request.member_id) {
    throw createConnectorError({ code: "TENANT_MISMATCH", message: "Die Detailantwort gehört nicht zur ausgewählten Mitgliederzeile.", request_id: context.request_id, retryable: false });
  }
  const { member_id: _memberId, ...fieldInput } = parsed;
  const maskedFields = [...new Set(request.masked_fields ?? [])].sort();
  const safeFieldInput = Object.fromEntries(Object.entries(fieldInput).filter(([key]) => !maskedFields.includes(key)));
  const fields = MEMBER_DETAIL_FIELDS_SCHEMA.parse(safeFieldInput) as MemberDetailFields & Record<string, import("@comvenio/connector-contracts").JsonValue>;
  return MEMBER_DETAIL_PANEL_SCHEMA.parse({
    member_id: parsed.member_id,
    display_name: row.display_name,
    fields,
    masked_fields: maskedFields,
    permission_explanation: ownMemberPermissionExplanation(snapshot),
  });
}

function filteredActions(
  input: MemberManagementProjectorInput,
  context: RequestContext,
  snapshot: CapabilitySnapshot,
  policy: MemberWidgetActionPolicy,
  visibleMemberIds: ReadonlySet<string>,
): ServerActionDescriptor[] {
  return (input.action_candidates ?? []).flatMap((candidate) => {
    const parsed = SERVER_ACTION_DESCRIPTOR_SCHEMA.safeParse(candidate);
    if (!parsed.success || parsed.data.visibility === "hidden") return [];
    const action = parsed.data;
    if (action.input === null || typeof action.input !== "object"
      || Array.isArray(action.input)
      || Object.prototype.hasOwnProperty.call(action.input, "club_id")) {
      return [];
    }
    if (typeof action.input.member_id === "string" && !visibleMemberIds.has(action.input.member_id)) return [];
    const decision = policy.evaluate({ context, capability_snapshot: snapshot, descriptor: action });
    if (!decision.allowed || decision.risk_class !== action.risk_class
      || decision.requires_confirmation !== action.requires_confirmation) return [];
    return [action];
  });
}

export class MemberManagementWidgetProjector {
  constructor(private readonly actionPolicy: MemberWidgetActionPolicy) {}

  project(input: MemberManagementProjectorInput): MemberManagementWidget {
    const binding = bound(input);
    const list = listSource.parse(input.list_source);
    const rows = list.items;
    return MEMBER_MANAGEMENT_WIDGET_SCHEMA.parse({
      widget: "member_management",
      contract_version: "1.0.0",
      title: "Mitgliederverwaltung",
      club: input.club,
      capability_version: binding.snapshot.capability_version,
      generated_at: input.generated_at ?? new Date().toISOString(),
      data: {
        query: input.query ?? null,
        rows,
        selected: selectedDetail(input, binding.context, binding.snapshot, rows),
      },
      actions: filteredActions(input, binding.context, binding.snapshot, this.actionPolicy, new Set(rows.map((row) => row.member_id))),
      empty_state: rows.length === 0
        ? { title: "Keine Mitglieder gefunden", description: "Passe die Suche an oder entferne einen Filter." }
        : null,
    });
  }
}

export function safeMemberPermissionChangedWidget(model: MemberManagementWidget): MemberManagementWidget {
  return MEMBER_MANAGEMENT_WIDGET_SCHEMA.parse({
    ...model,
    capability_version: null,
    data: { ...model.data, selected: null },
    actions: [],
  });
}
