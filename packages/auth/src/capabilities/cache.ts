import {
  normalizeRequestContext,
  type RequestContext,
} from "@comvenio/connector-contracts";

import { assertCapability } from "./errors.ts";
import type {
  CapabilityCacheResult,
  CapabilitySnapshot,
  EffectivePermissionSelfPort,
} from "./types.ts";
import { createCapabilitySnapshot } from "./version.ts";

type PrivateRequestContext = Omit<RequestContext, "subject_id" | "club_id"> & {
  subject_id: string;
  club_id: string;
};

function requirePrivateContext(context: RequestContext): PrivateRequestContext {
  const normalized = normalizeRequestContext(context);
  assertCapability(normalized.subject_id !== null, "CONTEXT_MISSING",
    "Die Rechteabfrage benötigt eine authentifizierte Subject-ID.");
  assertCapability(normalized.club_id !== null, "CONTEXT_MISSING",
    "Die Rechteabfrage benötigt einen expliziten Verein.");
  return normalized as PrivateRequestContext;
}

function cacheKey(context: PrivateRequestContext): string {
  return [context.subject_id, context.club_id, context.department_id ?? ""].join(":");
}

export class CapabilitySnapshotCache {
  readonly #port: EffectivePermissionSelfPort;
  readonly #now: () => Date;
  readonly #entries = new Map<string, CapabilitySnapshot>();
  readonly #inflight = new Map<string, Promise<CapabilitySnapshot>>();

  constructor(port: EffectivePermissionSelfPort, now: () => Date = () => new Date()) {
    this.#port = port;
    this.#now = now;
  }

  async read(input: {
    context: RequestContext;
    widget_capability_version?: string;
  }): Promise<CapabilityCacheResult> {
    const context = requirePrivateContext(input.context);
    const key = cacheKey(context);
    const cached = this.#entries.get(key);
    const nowMs = this.#now().getTime();
    if (cached && input.widget_capability_version
      && cached.capability_version !== input.widget_capability_version) {
      return { snapshot: await this.#reload(key, context), state: "VERSION_STALE_RELOADED" };
    }
    if (cached && context.capability_version
      && cached.capability_version !== context.capability_version) {
      return { snapshot: await this.#reload(key, context), state: "VERSION_STALE_RELOADED" };
    }
    if (cached && Date.parse(cached.expires_at) > nowMs) {
      return { snapshot: structuredClone(cached), state: "HIT" };
    }
    return {
      snapshot: await this.#reload(key, context),
      state: cached ? "EXPIRED_RELOADED" : "MISS_RELOADED",
    };
  }

  async beforeWrite(contextInput: RequestContext): Promise<CapabilityCacheResult> {
    const context = requirePrivateContext(contextInput);
    return {
      snapshot: await this.#reload(cacheKey(context), context),
      state: "WRITE_RECHECK",
    };
  }

  invalidateAfterForbidden(contextInput: RequestContext): void {
    const context = requirePrivateContext(contextInput);
    this.#entries.delete(cacheKey(context));
  }

  invalidateForClub(subjectId: string, clubId: string): void {
    const prefix = `${subjectId}:${clubId}:`;
    for (const key of this.#entries.keys()) {
      if (key.startsWith(prefix)) this.#entries.delete(key);
    }
  }

  async #reload(
    key: string,
    context: PrivateRequestContext,
  ): Promise<CapabilitySnapshot> {
    const existing = this.#inflight.get(key);
    if (existing) return structuredClone(await existing);
    const request = this.#load(context);
    this.#inflight.set(key, request);
    try {
      const snapshot = await request;
      this.#entries.set(key, snapshot);
      return structuredClone(snapshot);
    } finally {
      this.#inflight.delete(key);
    }
  }

  async #load(
    context: PrivateRequestContext,
  ): Promise<CapabilitySnapshot> {
    const observedAt = this.#now();
    const response = await this.#port.readSelf({
      request_id: context.request_id,
      subject_id: context.subject_id,
      club_id: context.club_id,
      department_id: context.department_id,
    });
    const snapshot = createCapabilitySnapshot({
      subject_id: context.subject_id,
      response,
      observed_at: observedAt,
    });
    assertCapability(snapshot.club_id === context.club_id, "TENANT_MISMATCH",
      "Der Capability-Snapshot gehört zu einem anderen Verein.");
    if (context.department_id !== null) {
      assertCapability(snapshot.department_ids.includes(context.department_id), "TENANT_MISMATCH",
        "Die gewählte Abteilung ist im Capability-Snapshot nicht sichtbar.");
    }
    return snapshot;
  }
}
