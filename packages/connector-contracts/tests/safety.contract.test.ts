import { describe, expect, test } from "bun:test";

import {
  ACTION_CONFIRM_INPUT_SCHEMA,
  ActionRiskClassifier,
  CONFIRMATION_TTL_SECONDS,
  IDEMPOTENCY_TTL_SECONDS,
  MemoryAtomicSafetyStore,
  PREVIEW_TTL_SECONDS,
  WriteSafetyService,
  confirmationRedisKey,
  createConnectorError,
  idempotencyRedisKey,
  previewRedisKey,
  sha256,
  type AtomicSafetyStore,
  type RequestContext,
  type SafetyAuthorizationPort,
  type SafetyClock,
  type SafetyRandom,
  type StoredPreviewEnvelope,
} from "@comvenio/connector-contracts";

const requestId = "11111111-1111-4111-8111-111111111111";
const subjectId = "22222222-2222-4222-8222-222222222222";
const clubId = "33333333-3333-4333-8333-333333333333";
const otherClubId = "44444444-4444-4444-8444-444444444444";
const oauthGrantId = "55555555-5555-4555-8555-555555555555";
const previewId = "66666666-6666-4666-8666-666666666666";
const receiptId = "77777777-7777-4777-8777-777777777777";
const secondPreviewId = "88888888-8888-4888-8888-888888888888";
const secondReceiptId = "99999999-9999-4999-8999-999999999999";
const targetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const idempotencyKey = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const secondIdempotencyKey = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const criticalToolName = "cv_event_publish_12345678";
const reversibleToolName = "cv_event_update_12345678";

const context: RequestContext = {
  request_id: requestId,
  surface: "mcp",
  provider: "anthropic",
  subject_id: subjectId,
  oauth_grant_id: oauthGrantId,
  club_id: clubId,
  department_id: null,
  scopes: ["event.read", "event.write"],
  capability_version: "cap-v1",
  locale: "de-DE",
  timezone: "Europe/Berlin",
};

class MutableClock implements SafetyClock {
  constructor(private timestamp = Date.parse("2026-07-21T12:00:00.000Z")) {}
  now(): Date { return new Date(this.timestamp); }
  advance(seconds: number): void { this.timestamp += seconds * 1_000; }
}

class SequenceRandom implements SafetyRandom {
  constructor(private readonly uuids: string[]) {}
  uuid(): string {
    const value = this.uuids.shift();
    if (!value) throw new Error("Keine deterministische UUID mehr verfügbar.");
    return value;
  }
  tokenBytes(length: number): Uint8Array { return new Uint8Array(length).fill(7); }
}

class RecordingStore extends MemoryAtomicSafetyStore {
  lastEnvelope: StoredPreviewEnvelope | null = null;
  override async createPreview(envelope: StoredPreviewEnvelope): Promise<void> {
    this.lastEnvelope = structuredClone(envelope);
    await super.createPreview(envelope);
  }
}

function authorizationState(): {
  port: SafetyAuthorizationPort;
  setAllowed(value: boolean): void;
  setCapabilityVersion(value: string): void;
  calls(): number;
} {
  let allowed = true;
  let capabilityVersion = "cap-v1";
  let callCount = 0;
  return {
    port: {
      async reauthorize(input) {
        callCount++;
        if (!allowed) {
          throw createConnectorError({
            code: "PERMISSION_DENIED",
            message: `Keine Berechtigung für ${input.tool_name}.`,
            request_id: input.context.request_id,
            retryable: false,
          });
        }
        return { capability_version: capabilityVersion };
      },
    },
    setAllowed(value) { allowed = value; },
    setCapabilityVersion(value) { capabilityVersion = value; },
    calls() { return callCount; },
  };
}

function fixture(uuids = [previewId, receiptId]): {
  service: WriteSafetyService;
  store: RecordingStore;
  clock: MutableClock;
  authorization: ReturnType<typeof authorizationState>;
} {
  const store = new RecordingStore();
  const clock = new MutableClock();
  const authorization = authorizationState();
  return {
    store,
    clock,
    authorization,
    service: new WriteSafetyService({
      store,
      clock,
      authorization: authorization.port,
      random: new SequenceRandom([...uuids]),
    }),
  };
}

function criticalPreview(service: WriteSafetyService, requestContext = context) {
  return service.createCriticalPreview({
    context: requestContext,
    operation: {
      tool_name: criticalToolName,
      risk_class: "critical_write",
      execution_mode: "async_job",
    },
    normalized_input: {
      club_id: requestContext.club_id,
      event_id: targetId,
      publish: true,
    },
    target: { type: "event", id: targetId, label: "Sommerfest" },
    impact: {
      creates: 0,
      updates: 1,
      deletes: 0,
      publishes: 1,
      imports: 0,
      exports: 0,
      affected_total: 2,
      summary: "Eine Veranstaltung wird aktualisiert und veröffentlicht.",
    },
    masked_fields: ["contact_email", "contact_email", "bank_account"],
    safe_summary: "Die Veranstaltung Sommerfest wird veröffentlicht.",
    object_version: "event-v1",
  });
}

function successfulEffect() {
  return {
    target_ids: [targetId],
    changed_count: 1,
    unchanged_count: 0,
    failed_count: 0,
    result_summary: "Die Veranstaltung wurde veröffentlicht.",
    object_versions: [{ target_id: targetId, version: "event-v2" }],
    safe_next_actions: [{
      kind: "view" as const,
      label: "Veranstaltung anzeigen",
      tool_name: "cv_event_show_12345678",
      available_until: null,
    }],
  };
}

function connectorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

describe("K14 write safety contract", () => {
  test("TC-01: validates the entity contract and keeps risk separate from execution mode", async () => {
    const classifier = new ActionRiskClassifier();
    expect(classifier.classify({ risk_class: "critical_write" })).toBe("critical_write");
    expect(classifier.aggregate([
      { risk_class: "read" },
      { risk_class: "critical_write" },
      { risk_class: "reversible_write" },
    ])).toBe("critical_write");

    const { service, store } = fixture();
    const challenge = await criticalPreview(service);
    const envelope = store.lastEnvelope;
    if (!envelope) throw new Error("Der interne Preview-Record fehlt.");

    expect(challenge.confirmation_token).toHaveLength(43);
    expect(challenge.preview).toEqual({
      preview_id: previewId,
      request_id: requestId,
      club_id: clubId,
      tool_name: criticalToolName,
      risk_class: "critical_write",
      target: { type: "event", id: targetId, label: "Sommerfest" },
      impact: {
        creates: 0,
        updates: 1,
        deletes: 0,
        publishes: 1,
        imports: 0,
        exports: 0,
        affected_total: 2,
        summary: "Eine Veranstaltung wird aktualisiert und veröffentlicht.",
      },
      safe_summary: "Die Veranstaltung Sommerfest wird veröffentlicht.",
      masked_fields: ["bank_account", "contact_email"],
      expires_at: "2026-07-21T12:05:00.000Z",
    });
    expect("normalized_input" in challenge.preview).toBe(false);
    expect("payload_hash_sha256" in challenge.preview).toBe(false);
    expect("subject_id" in challenge.preview).toBe(false);
    expect("capability_version" in challenge.preview).toBe(false);
    expect(envelope.preview.normalized_input).toEqual({ club_id: clubId, event_id: targetId, publish: true });
    expect(envelope.confirmation.token_hash_sha256).toBe(sha256(challenge.confirmation_token));
    expect(envelope.confirmation.token_hash_sha256).not.toBe(challenge.confirmation_token);
    expect(JSON.stringify(envelope)).not.toContain(challenge.confirmation_token);
    expect(envelope.object_version).toBe("event-v1");

    expect(() => ACTION_CONFIRM_INPUT_SCHEMA.parse({
      preview_id: previewId,
      confirmation_token: challenge.confirmation_token,
      idempotency_key: idempotencyKey,
      normalized_input: { publish: false },
    })).toThrow();
  });

  test("TC-02: reauthorizes preview and confirm and writes only the server-stored payload", async () => {
    const { service, authorization } = fixture();
    const challenge = await criticalPreview(service);
    let mutationCalls = 0;
    let receivedInput: unknown;
    let receivedKey: unknown;

    const receipt = await service.confirmCriticalWrite({
      context,
      tool_name: criticalToolName,
      preview_id: challenge.preview.preview_id,
      confirmation_token: challenge.confirmation_token,
      idempotency_key: idempotencyKey,
      current_object_version: "event-v1",
    }, async (normalizedInput, key) => {
      mutationCalls++;
      receivedInput = normalizedInput;
      receivedKey = key;
      return successfulEffect();
    });

    expect(authorization.calls()).toBe(2);
    expect(mutationCalls).toBe(1);
    expect(receivedInput).toEqual({ club_id: clubId, event_id: targetId, publish: true });
    expect(receivedKey).toBe(idempotencyKey);
    expect(receipt).toMatchObject({
      receipt_id: receiptId,
      subject_id: subjectId,
      club_id: clubId,
      tool_name: criticalToolName,
      outcome: "succeeded",
      changed_count: 1,
      idempotency_key: idempotencyKey,
    });
  });

  test("TC-03: missing, malformed or payload-bearing confirmation cannot mutate data", async () => {
    const { service } = fixture();
    const challenge = await criticalPreview(service);
    let writes = 0;
    const mutation = async () => { writes++; return successfulEffect(); };

    await expect(service.confirmCriticalWrite({
      context,
      tool_name: criticalToolName,
      preview_id: challenge.preview.preview_id,
      confirmation_token: "missing-token",
      idempotency_key: idempotencyKey,
      current_object_version: "event-v1",
    }, mutation)).rejects.toThrow();
    expect(writes).toBe(0);

    expect(() => ACTION_CONFIRM_INPUT_SCHEMA.parse({
      preview_id: challenge.preview.preview_id,
      confirmation_token: challenge.confirmation_token,
      idempotency_key: idempotencyKey,
      payload: { publish: false },
    })).toThrow();
  });

  test("TC-04: rejects cross-tenant, capability-drift, permission-loss and expired confirmations", async () => {
    const crossTenant = fixture();
    const crossTenantChallenge = await criticalPreview(crossTenant.service);
    let writes = 0;
    await expect(crossTenant.service.confirmCriticalWrite({
      context: { ...context, club_id: otherClubId },
      tool_name: criticalToolName,
      preview_id: crossTenantChallenge.preview.preview_id,
      confirmation_token: crossTenantChallenge.confirmation_token,
      idempotency_key: idempotencyKey,
      current_object_version: "event-v1",
    }, async () => { writes++; return successfulEffect(); })).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });
    expect(writes).toBe(0);

    crossTenant.authorization.setCapabilityVersion("cap-v2");
    await expect(crossTenant.service.confirmCriticalWrite({
      context,
      tool_name: criticalToolName,
      preview_id: crossTenantChallenge.preview.preview_id,
      confirmation_token: crossTenantChallenge.confirmation_token,
      idempotency_key: idempotencyKey,
      current_object_version: "event-v1",
    }, async () => { writes++; return successfulEffect(); })).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });
    expect(writes).toBe(0);

    const permissionLoss = fixture();
    const permissionChallenge = await criticalPreview(permissionLoss.service);
    permissionLoss.authorization.setAllowed(false);
    await expect(permissionLoss.service.confirmCriticalWrite({
      context,
      tool_name: criticalToolName,
      preview_id: permissionChallenge.preview.preview_id,
      confirmation_token: permissionChallenge.confirmation_token,
      idempotency_key: idempotencyKey,
      current_object_version: "event-v1",
    }, async () => { writes++; return successfulEffect(); })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(writes).toBe(0);

    const expired = fixture();
    const expiredChallenge = await criticalPreview(expired.service);
    expired.clock.advance(PREVIEW_TTL_SECONDS + 1);
    try {
      await expired.service.confirmCriticalWrite({
        context,
        tool_name: criticalToolName,
        preview_id: expiredChallenge.preview.preview_id,
        confirmation_token: expiredChallenge.confirmation_token,
        idempotency_key: idempotencyKey,
        current_object_version: "event-v1",
      }, async () => { writes++; return successfulEffect(); });
      throw new Error("Die abgelaufene Bestätigung wurde unerwartet akzeptiert.");
    } catch (error) {
      expect(connectorCode(error)).toBe("CONFIRMATION_EXPIRED");
    }
    expect(writes).toBe(0);
  });

  test("TC-05: identical provider retries produce one write and the exact same receipt", async () => {
    const { service } = fixture();
    const challenge = await criticalPreview(service);
    let writes = 0;
    const request = {
      context,
      tool_name: criticalToolName,
      preview_id: challenge.preview.preview_id,
      confirmation_token: challenge.confirmation_token,
      idempotency_key: idempotencyKey,
      current_object_version: "event-v1",
    };
    const mutation = async () => { writes++; return successfulEffect(); };

    const first = await service.confirmCriticalWrite(request, mutation);
    const replay = await service.confirmCriticalWrite(request, mutation);

    expect(writes).toBe(1);
    expect(replay).toEqual(first);
    expect(replay.receipt_id).toBe(receiptId);
  });

  test("TC-06: stale object state fails closed and permanently cancels the preview", async () => {
    const { service } = fixture();
    const challenge = await criticalPreview(service);
    let writes = 0;
    const baseRequest = {
      context,
      tool_name: criticalToolName,
      preview_id: challenge.preview.preview_id,
      confirmation_token: challenge.confirmation_token,
      idempotency_key: idempotencyKey,
    };

    await expect(service.confirmCriticalWrite({
      ...baseRequest,
      current_object_version: "event-v2",
    }, async () => { writes++; return successfulEffect(); })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.confirmCriticalWrite({
      ...baseRequest,
      current_object_version: "event-v1",
    }, async () => { writes++; return successfulEffect(); })).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });
    expect(writes).toBe(0);
  });

  test("enforces exact TTL/key contracts and idempotency for reversible success and failure", async () => {
    expect(PREVIEW_TTL_SECONDS).toBe(300);
    expect(CONFIRMATION_TTL_SECONDS).toBe(300);
    expect(IDEMPOTENCY_TTL_SECONDS).toBe(86_400);
    expect(previewRedisKey(previewId)).toBe(`mcp:preview:${previewId}`);
    expect(confirmationRedisKey("a".repeat(64))).toBe(`mcp:confirm:${"a".repeat(64)}`);
    expect(idempotencyRedisKey(subjectId, clubId, reversibleToolName, idempotencyKey)).toBe(
      `mcp:idem:${subjectId}:${clubId}:${reversibleToolName}:${idempotencyKey}`,
    );

    const successful = fixture([receiptId]);
    let writes = 0;
    const request = {
      context,
      operation: {
        tool_name: reversibleToolName,
        risk_class: "reversible_write" as const,
        execution_mode: "inline" as const,
      },
      normalized_input: { event_id: targetId, title: "Sommerfest 2027" },
      idempotency_key: idempotencyKey,
    };
    const first = await successful.service.executeReversibleWrite(request, async () => { writes++; return successfulEffect(); });
    const replay = await successful.service.executeReversibleWrite(request, async () => { writes++; return successfulEffect(); });
    expect(replay).toEqual(first);
    expect(writes).toBe(1);

    await expect(successful.service.executeReversibleWrite({
      ...request,
      normalized_input: { event_id: targetId, title: "Andere Wirkung" },
    }, async () => { writes++; return successfulEffect(); })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(writes).toBe(1);

    const failing = fixture([secondReceiptId]);
    let failures = 0;
    const failedRequest = { ...request, idempotency_key: secondIdempotencyKey };
    const failed = await failing.service.executeReversibleWrite(failedRequest, async () => {
      failures++;
      throw new Error("private upstream detail");
    });
    const failedReplay = await failing.service.executeReversibleWrite(failedRequest, async () => {
      failures++;
      return successfulEffect();
    });
    expect(failures).toBe(1);
    expect(failedReplay).toEqual(failed);
    expect(failed).toMatchObject({
      receipt_id: secondReceiptId,
      outcome: "failed",
      result_summary: "Die Fachaktion konnte nicht abgeschlossen werden.",
    });
    expect(JSON.stringify(failed)).not.toContain("private upstream detail");
  });
});

test("the reference store remains substitutable through the atomic store port", () => {
  const store: AtomicSafetyStore = new MemoryAtomicSafetyStore();
  expect(store).toBeInstanceOf(MemoryAtomicSafetyStore);
});
