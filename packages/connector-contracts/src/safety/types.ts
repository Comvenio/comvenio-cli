import type { JsonValue, RequestContext, UUID } from "../index.ts";

export type ActionRisk = "read" | "reversible_write" | "critical_write";
export type PreviewStatus = "open" | "consumed" | "expired" | "cancelled";
export type IdempotencyState = "started" | "succeeded" | "failed";

export interface ActionTarget {
  type: string;
  id: UUID | null;
  label: string;
}

export interface ActionImpact {
  creates: number;
  updates: number;
  deletes: number;
  publishes: number;
  imports: number;
  exports: number;
  affected_total: number;
  summary: string;
}

export interface InternalActionPreviewRecord {
  preview_id: UUID;
  request_id: UUID;
  subject_id: UUID;
  club_id: UUID;
  tool_name: string;
  risk_class: "critical_write";
  normalized_input: JsonValue;
  payload_hash_sha256: string;
  target: ActionTarget;
  impact: ActionImpact;
  masked_fields: string[];
  capability_version: string;
  created_at: string;
  expires_at: string;
  status: PreviewStatus;
}

export interface ActionPreviewView {
  preview_id: UUID;
  request_id: UUID;
  club_id: UUID;
  tool_name: string;
  risk_class: "critical_write";
  target: ActionTarget;
  impact: ActionImpact;
  safe_summary: string;
  masked_fields: string[];
  expires_at: string;
}

export interface ConfirmationTokenRecord {
  token_hash_sha256: string;
  preview_id: UUID;
  subject_id: UUID;
  club_id: UUID;
  tool_name: string;
  payload_hash_sha256: string;
  capability_version: string;
  expires_at: string;
  consumed_at: string | null;
}

export type ConfirmationToken = ConfirmationTokenRecord;

export interface SafeNextAction {
  kind: "undo" | "view" | "retry_failed";
  label: string;
  tool_name: string;
  available_until: string | null;
}

export interface WriteReceipt {
  receipt_id: UUID;
  request_id: UUID;
  subject_id: UUID;
  club_id: UUID;
  tool_name: string;
  target_ids: UUID[];
  outcome: "succeeded" | "partially_succeeded" | "failed";
  changed_count: number;
  unchanged_count: number;
  failed_count: number;
  result_summary: string;
  object_versions: Array<{ target_id: UUID; version: string }>;
  safe_next_actions: SafeNextAction[];
  idempotency_key: UUID;
  completed_at: string;
}

export interface IdempotencyRecord {
  subject_id: UUID;
  club_id: UUID;
  tool_name: string;
  idempotency_key: UUID;
  payload_hash_sha256: string;
  state: IdempotencyState;
  receipt: WriteReceipt | null;
  created_at: string;
  expires_at: string;
}

export interface ConfirmationChallenge {
  preview: ActionPreviewView;
  confirmation_token: string;
  confirm_label: string;
  cancel_label: "Abbrechen";
  acknowledgement_required: boolean;
}

export interface SafetyCatalogOperation {
  tool_name: string;
  risk_class: ActionRisk;
  execution_mode: "inline" | "async_job";
}

export interface CreateCriticalPreviewRequest {
  context: RequestContext;
  operation: SafetyCatalogOperation & { risk_class: "critical_write" };
  normalized_input: JsonValue;
  target: ActionTarget;
  impact: ActionImpact;
  masked_fields: string[];
  safe_summary: string;
  object_version: string | null;
}

export interface ConfirmCriticalWriteRequest {
  context: RequestContext;
  tool_name: string;
  preview_id: UUID;
  confirmation_token: string;
  idempotency_key: UUID;
  current_object_version: string | null;
}

export interface ExecuteReversibleWriteRequest {
  context: RequestContext;
  operation: SafetyCatalogOperation & { risk_class: "reversible_write" };
  normalized_input: JsonValue;
  idempotency_key: UUID;
}

export interface SafeWriteEffect {
  target_ids: UUID[];
  changed_count: number;
  unchanged_count: number;
  failed_count: number;
  result_summary: string;
  object_versions: Array<{ target_id: UUID; version: string }>;
  safe_next_actions: SafeNextAction[];
}

export interface SafetyAuthorizationPort {
  reauthorize(input: { context: RequestContext; tool_name: string; risk_class: "reversible_write" | "critical_write" }): Promise<{ capability_version: string }>;
}

export interface StoredPreviewEnvelope {
  preview: InternalActionPreviewRecord;
  confirmation: ConfirmationTokenRecord;
  object_version: string | null;
}

export type DispatchReservationResult =
  | { kind: "dispatch"; preview: InternalActionPreviewRecord; idempotency: IdempotencyRecord }
  | { kind: "replay"; receipt: WriteReceipt }
  | { kind: "confirmation_expired" }
  | { kind: "confirmation_mismatch" }
  | { kind: "stale" }
  | { kind: "idempotency_mismatch" }
  | { kind: "in_progress" };

export type DirectReservationResult =
  | { kind: "dispatch"; idempotency: IdempotencyRecord }
  | { kind: "replay"; receipt: WriteReceipt }
  | { kind: "idempotency_mismatch" }
  | { kind: "in_progress" };

export interface AtomicSafetyStore {
  createPreview(envelope: StoredPreviewEnvelope): Promise<void>;
  consumeConfirmationAndReserve(input: {
    now: string;
    token_hash_sha256: string;
    preview_id: UUID;
    subject_id: UUID;
    club_id: UUID;
    tool_name: string;
    capability_version: string;
    current_object_version: string | null;
    idempotency_key: UUID;
    idempotency_expires_at: string;
  }): Promise<DispatchReservationResult>;
  reserveDirect(input: { now: string; subject_id: UUID; club_id: UUID; tool_name: string; idempotency_key: UUID; payload_hash_sha256: string; expires_at: string }): Promise<DirectReservationResult>;
  completeIdempotency(input: { subject_id: UUID; club_id: UUID; tool_name: string; idempotency_key: UUID; state: "succeeded" | "failed"; receipt: WriteReceipt }): Promise<void>;
}

export interface SafetyClock { now(): Date; }
export interface SafetyRandom { uuid(): UUID; tokenBytes(length: number): Uint8Array; }
