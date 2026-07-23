import {
  ACTION_CONFIRM_INPUT_SCHEMA,
  ACTION_CONFIRM_WIDGET_INPUT_SCHEMA,
  CONFIRMATION_CHALLENGE_SCHEMA,
  CONFIRMATION_WIDGET_SCHEMA,
  SERVER_ACTION_DESCRIPTOR_SCHEMA,
  createConnectorError,
  normalizeRequestContext,
  type ConfirmationWidget,
  type RequestContext,
} from "@comvenio/connector-contracts";
import type { CapabilitySnapshot } from "@comvenio/auth";

import type { ConfirmationWidgetPolicy, ConfirmationWidgetProjectorInput } from "./types.ts";

function bound(input: ConfirmationWidgetProjectorInput): { context: RequestContext; snapshot: CapabilitySnapshot } {
  const context = normalizeRequestContext(input.context);
  const snapshot = input.capability_snapshot;
  if (!context.subject_id || !context.oauth_grant_id || !context.club_id) throw createConnectorError({ code: "AUTH_REQUIRED", message: "Für die Bestätigung ist eine aktive Verbindung erforderlich.", request_id: context.request_id, retryable: false });
  if (context.club_id !== input.club.club_id || snapshot.club_id !== input.club.club_id || snapshot.subject_id !== context.subject_id) throw createConnectorError({ code: "TENANT_MISMATCH", message: "Die Vorschau gehört nicht zum ausgewählten Verein.", request_id: context.request_id, retryable: false });
  if (!context.capability_version || context.capability_version !== snapshot.capability_version) throw createConnectorError({ code: "PERMISSION_DENIED", message: "Die Berechtigungen haben sich geändert. Erstelle eine neue Vorschau.", request_id: context.request_id, retryable: false });
  return { context, snapshot };
}

function containsSensitiveRawValue(value: string): boolean {
  return /(?:[A-Z]{2}\d{2}[A-Z0-9]{11,30}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|bearer\s+[A-Z0-9._~-]+|(?:password|secret|token)\s*[:=])/iu.test(value);
}

export class ConfirmationWidgetProjector {
  constructor(private readonly policy: ConfirmationWidgetPolicy) {}
  project(input: ConfirmationWidgetProjectorInput): ConfirmationWidget {
    const binding = bound(input);
    const challenge = CONFIRMATION_CHALLENGE_SCHEMA.parse(input.challenge);
    const action = SERVER_ACTION_DESCRIPTOR_SCHEMA.parse(input.confirm_action);
    const confirmInput = ACTION_CONFIRM_INPUT_SCHEMA.safeParse(action.input);
    const generatedAt = input.generated_at ?? new Date().toISOString();
    if (challenge.preview.club_id !== input.club.club_id) throw createConnectorError({ code: "TENANT_MISMATCH", message: "Die Vorschau gehört nicht zum ausgewählten Verein.", request_id: binding.context.request_id, retryable: false });
    if (Date.parse(challenge.preview.expires_at) <= Date.parse(generatedAt)) throw createConnectorError({ code: "CONFIRMATION_EXPIRED", message: "Die Vorschau ist abgelaufen. Bitte erstelle eine neue Vorschau.", request_id: binding.context.request_id, retryable: false });
    if (containsSensitiveRawValue(`${challenge.preview.safe_summary}\n${challenge.preview.target.label}\n${challenge.preview.impact.summary}`)) throw createConnectorError({ code: "VALIDATION_FAILED", message: "Die Vorschau enthält einen nicht maskierten sensiblen Wert.", request_id: binding.context.request_id, retryable: false });
    if (!this.policy.evaluate({ context: binding.context, capability_snapshot: binding.snapshot, preview: challenge.preview }).allowed) throw createConnectorError({ code: "PERMISSION_DENIED", message: "Die kritische Aktion ist im aktuellen Kontext nicht verfügbar.", request_id: binding.context.request_id, retryable: false });
    if (action.visibility !== "visible" || !action.enabled || action.tool_name !== "action_confirm" || action.risk_class !== "critical_write" || !action.requires_confirmation
      || !confirmInput.success || confirmInput.data.preview_id !== challenge.preview.preview_id || confirmInput.data.confirmation_token !== challenge.confirmation_token) {
      throw createConnectorError({ code: "VALIDATION_FAILED", message: "Die Bestätigungsaktion ist nicht exakt an die Vorschau gebunden.", request_id: binding.context.request_id, retryable: false });
    }
    const widgetAction = SERVER_ACTION_DESCRIPTOR_SCHEMA.parse({
      ...action,
      input: ACTION_CONFIRM_WIDGET_INPUT_SCHEMA.parse({
        preview_id: confirmInput.data.preview_id,
        idempotency_key: confirmInput.data.idempotency_key,
      }),
    });
    return CONFIRMATION_WIDGET_SCHEMA.parse({
      widget: "confirmation", contract_version: "1.0.0", title: "Aktion bestätigen", club: input.club,
      capability_version: binding.snapshot.capability_version, generated_at: generatedAt,
      data: {
        preview: challenge.preview,
        confirm_label: challenge.confirm_label,
        cancel_label: challenge.cancel_label,
        acknowledgement_required: challenge.acknowledgement_required,
      },
      actions: [widgetAction],
      empty_state: null,
    });
  }
}
